import type { MailProvider } from '../mail-provider/MailProvider.js';
import { plainTextSnippet } from '../lib/plainTextSnippet.js';
import { ensureLabel } from '../mail-provider/labelRegistry.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import {
  decideSender,
  getSenderApproval,
  incrementHeldCount,
  insertPendingSender,
  listBlockedSenders,
  listPendingSenders,
  setThreadIdIfMissing,
} from '../db/senderApprovals.js';

export const GATEKEEPER_PENDING_LABEL = 'App/Gatekeeper-Pending';
export const GATEKEEPER_BLOCKED_LABEL = 'App/Gatekeeper-Blocked';

// Bucket views (Receipts / Feed tabs) come later, but these labels exist
// early so imported senders with a bucket already assigned don't flood
// Yobox with mail that isn't meant to land there.
export const BUCKET_LABELS: Record<string, string> = {
  receipts: 'App/Receipts',
  feed: 'App/Feed',
};

export type ApprovalBucket = 'yobox' | 'receipts' | 'feed';
export const VALID_BUCKETS: ApprovalBucket[] = ['yobox', 'receipts', 'feed'];

export interface GateResult {
  status: 'pending' | 'approved' | 'blocked';
  bucket: string | null;
}

// Called for every thread in the Yobox (INBOX) listing. New senders are
// inserted as pending and their thread pulled out of the inbox into the
// Gatekeeper queue; already-decided senders pass straight through (approved)
// or stay hidden (blocked). Gmail's own INBOX label is the actual gate:
// once removed, the thread stops showing up in future INBOX listings, so
// this only does real work the first time a given thread is seen.
export async function gateThreadBySender(
  mailProvider: MailProvider,
  thread: { id: string; snippet: string },
  sender: { email: string; name?: string },
): Promise<GateResult> {
  const email = sender.email.toLowerCase();
  const domain = email.split('@')[1] ?? '';

  let approval = getSenderApproval(email);
  if (!approval) {
    insertPendingSender({
      senderEmail: email,
      senderDomain: domain,
      displayName: sender.name ?? null,
      firstSnippet: plainTextSnippet(thread.snippet),
      firstThreadId: thread.id,
    });
    approval = getSenderApproval(email);
  } else if (approval.status === 'pending' && !approval.first_thread_id) {
    setThreadIdIfMissing(email, thread.id);
  }

  if (approval?.status === 'approved') {
    const bucket = approval.bucket;
    const bucketLabelName = bucket ? BUCKET_LABELS[bucket] : undefined;
    if (bucketLabelName) {
      const labelId = await ensureLabel(mailProvider, bucketLabelName);
      await mailProvider.modifyThreadLabels(thread.id, { remove: ['INBOX'], add: [labelId] });
    }
    return { status: 'approved', bucket };
  }

  if (approval?.status === 'blocked') {
    const labelId = await ensureLabel(mailProvider, GATEKEEPER_BLOCKED_LABEL);
    await mailProvider.modifyThreadLabels(thread.id, { remove: ['INBOX'], add: [labelId] });
    return { status: 'blocked', bucket: null };
  }

  incrementHeldCount(email);
  const labelId = await ensureLabel(mailProvider, GATEKEEPER_PENDING_LABEL);
  await mailProvider.modifyThreadLabels(thread.id, { remove: ['INBOX'], add: [labelId] });
  return { status: 'pending', bucket: null };
}

async function findThreadsByLabelAndSender(
  mailProvider: MailProvider,
  email: string,
  labelName: string,
): Promise<string[]> {
  const { threadIds } = await mailProvider.listThreadIds({
    q: `from:${email} label:${labelName}`,
    maxResults: 100,
  });
  return threadIds;
}

async function findHeldThreadIds(mailProvider: MailProvider, email: string): Promise<string[]> {
  return findThreadsByLabelAndSender(mailProvider, email, GATEKEEPER_PENDING_LABEL);
}

// The Gmail search name for whatever a sender's current bucket is, used to
// find their already-labeled threads. `null`/'yobox' means plain INBOX.
function bucketSearchLabel(bucket: string | null): string {
  return (bucket && BUCKET_LABELS[bucket]) || 'inbox';
}

// The real Gmail label ID for a bucket. INBOX is a system label (id ===
// name), custom buckets need creating/looking up.
async function bucketLabelId(mailProvider: MailProvider, bucket: string | null): Promise<string> {
  if (bucket && BUCKET_LABELS[bucket]) {
    return ensureLabel(mailProvider, BUCKET_LABELS[bucket]);
  }
  return 'INBOX';
}

export async function approveSender(
  mailProvider: MailProvider,
  email: string,
  bucket: ApprovalBucket = 'yobox',
): Promise<string[]> {
  decideSender(email, 'approved', bucket === 'yobox' ? null : bucket);
  const pendingLabelId = await ensureLabel(mailProvider, GATEKEEPER_PENDING_LABEL);
  const threadIds = await findHeldThreadIds(mailProvider, email);

  if (bucket === 'yobox') {
    await mapWithConcurrency(threadIds, 5, (id) =>
      mailProvider.modifyThreadLabels(id, { add: ['INBOX'], remove: [pendingLabelId] }),
    );
  } else {
    const bucketLabelId = await ensureLabel(mailProvider, BUCKET_LABELS[bucket]);
    await mapWithConcurrency(threadIds, 5, (id) =>
      mailProvider.modifyThreadLabels(id, { add: [bucketLabelId], remove: [pendingLabelId, 'INBOX'] }),
    );
  }
  return threadIds;
}

export async function blockSender(mailProvider: MailProvider, email: string): Promise<void> {
  decideSender(email, 'blocked');
  const pendingLabelId = await ensureLabel(mailProvider, GATEKEEPER_PENDING_LABEL);
  const blockedLabelId = await ensureLabel(mailProvider, GATEKEEPER_BLOCKED_LABEL);
  const threadIds = await findHeldThreadIds(mailProvider, email);
  await mapWithConcurrency(threadIds, 5, (id) =>
    mailProvider.modifyThreadLabels(id, { add: [blockedLabelId], remove: [pendingLabelId, 'INBOX'] }),
  );
}

// "Move to..." reclassifies an already-approved sender's bucket going
// forward, and re-labels every thread of theirs currently sitting under
// their OLD bucket's label (not just the one thread being viewed).
//
// For a sender still held in the Gatekeeper, moving IS approving: it decides
// them into the target bucket and releases their held threads there. This is
// what powers the same "Move to" controls inside a Gatekeeper thread view —
// no need to bounce back to the Gatekeeper list first.
export async function moveSenderToBucket(
  mailProvider: MailProvider,
  email: string,
  newBucket: ApprovalBucket,
): Promise<{ movedThreadIds: string[] }> {
  const approval = getSenderApproval(email);
  if (approval?.status === 'blocked') {
    throw new Error(`${email} is blocked; unblock them first if you want their mail`);
  }
  if (!approval) {
    // Sender never went through the gate (e.g. mail predating yo). Seed a
    // row so decideSender's UPDATE has something to land on.
    insertPendingSender({
      senderEmail: email,
      senderDomain: email.split('@')[1] ?? '',
      displayName: null,
      firstSnippet: '',
      firstThreadId: '',
    });
  }
  if (!approval || approval.status === 'pending') {
    const movedThreadIds = await approveSender(mailProvider, email, newBucket);
    return { movedThreadIds };
  }

  const oldBucket = approval.bucket;
  const normalizedNewBucket = newBucket === 'yobox' ? null : newBucket;
  if (oldBucket === normalizedNewBucket) {
    return { movedThreadIds: [] };
  }

  const oldSearchLabel = bucketSearchLabel(oldBucket);
  const threadIds = await findThreadsByLabelAndSender(mailProvider, email, oldSearchLabel);

  const [oldLabelId, newLabelId] = await Promise.all([
    bucketLabelId(mailProvider, oldBucket),
    bucketLabelId(mailProvider, normalizedNewBucket),
  ]);

  await mapWithConcurrency(threadIds, 5, (id) =>
    mailProvider.modifyThreadLabels(id, { add: [newLabelId], remove: [oldLabelId] }),
  );

  decideSender(email, 'approved', normalizedNewBucket);
  return { movedThreadIds: threadIds };
}

export { listPendingSenders, listBlockedSenders };

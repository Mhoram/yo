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

export interface GateOptions {
  // List views pass this: a gated thread is excluded from the response
  // purely from the local decision, so the Gmail label move that files it
  // away can happen after the response is sent instead of adding a
  // threads.modify round-trip per gated thread to page load (measured at
  // ~1.2s on a page with five threads to file). Default stays synchronous
  // for callers (and tests) that need the filing to have happened.
  deferFiling?: boolean;
}

// Threads currently being filed by a deferred label move. Dedupes the
// modify itself and, for pending senders, guards held_count against a
// reload that re-sees the thread in INBOX before the move lands.
const filingInFlight = new Map<string, Promise<void>>();

async function fileThreadNow(mailProvider: MailProvider, threadId: string, labelName: string): Promise<void> {
  const labelId = await ensureLabel(mailProvider, labelName);
  await mailProvider.modifyThreadLabels(threadId, { remove: ['INBOX'], add: [labelId] });
}

function fileThread(mailProvider: MailProvider, threadId: string, labelName: string, defer: boolean): Promise<void> | void {
  if (!defer) return fileThreadNow(mailProvider, threadId, labelName);
  if (filingInFlight.has(threadId)) return;
  const promise = fileThreadNow(mailProvider, threadId, labelName)
    .catch((err) => console.error(`Deferred label filing failed for thread ${threadId}`, err))
    .finally(() => filingInFlight.delete(threadId));
  filingInFlight.set(threadId, promise);
}

// Test-only: lets tests await fire-and-forget deferred filing before
// asserting on label state. Not used by app code.
export function __flushDeferredFilingForTests(): Promise<void[]> {
  return Promise.all(Array.from(filingInFlight.values()));
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
  opts?: GateOptions,
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
      await fileThread(mailProvider, thread.id, bucketLabelName, opts?.deferFiling ?? false);
    }
    return { status: 'approved', bucket };
  }

  if (approval?.status === 'blocked') {
    await fileThread(mailProvider, thread.id, GATEKEEPER_BLOCKED_LABEL, opts?.deferFiling ?? false);
    return { status: 'blocked', bucket: null };
  }

  // A reload can re-see the thread while its deferred filing is still in
  // flight; don't count it held a second time.
  if (!filingInFlight.has(thread.id)) incrementHeldCount(email);
  await fileThread(mailProvider, thread.id, GATEKEEPER_PENDING_LABEL, opts?.deferFiling ?? false);
  return { status: 'pending', bucket: null };
}

async function findThreadsByLabelAndSender(
  mailProvider: MailProvider,
  email: string,
  // null = no location constraint: matches archived threads too. Gmail's
  // search still excludes trash/spam, so this can't resurrect deleted mail.
  labelName: string | null,
): Promise<string[]> {
  const { threadIds } = await mailProvider.listThreadIds({
    q: labelName ? `from:${email} label:${labelName}` : `from:${email}`,
    maxResults: 100,
  });
  return threadIds;
}

async function findHeldThreadIds(mailProvider: MailProvider, email: string): Promise<string[]> {
  return findThreadsByLabelAndSender(mailProvider, email, GATEKEEPER_PENDING_LABEL);
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

// Screening out a sender files ALL of their non-trash/spam threads under
// the blocked label, not just ones currently held: "Screen out" is offered
// from any box's thread view, where the sender is usually approved with
// mail sitting in INBOX or a bucket. The search deliberately has NO location
// label (same reasoning as moveSenderToBucket): archived threads carry no
// location label at all, and a label-scoped search silently missed them.
// For a sender still held in the Gatekeeper this finds the same held
// threads the old pending-only search did, so the Gatekeeper flow is
// unchanged.
export async function blockSender(mailProvider: MailProvider, email: string): Promise<void> {
  const approval = getSenderApproval(email);
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
  // Capture the old bucket before decideSender clears it: approved
  // senders' threads carry that bucket label and it must come off.
  const oldBucket = approval?.bucket ?? null;
  decideSender(email, 'blocked');

  const blockedLabelId = await ensureLabel(mailProvider, GATEKEEPER_BLOCKED_LABEL);
  const pendingLabelId = await ensureLabel(mailProvider, GATEKEEPER_PENDING_LABEL);
  const remove: string[] = [pendingLabelId, 'INBOX'];
  if (oldBucket && BUCKET_LABELS[oldBucket]) {
    remove.push(await ensureLabel(mailProvider, BUCKET_LABELS[oldBucket]));
  }

  const threadIds = await findThreadsByLabelAndSender(mailProvider, email, null);
  await mapWithConcurrency(threadIds, 5, (id) =>
    mailProvider.modifyThreadLabels(id, { add: [blockedLabelId], remove }),
  );
}

// "Move to..." reclassifies an already-approved sender's bucket going
// forward, and re-files ALL of the sender's non-trash/spam threads into
// the new bucket (not just the one being viewed). The search deliberately
// has NO location label: threads that were archived carry no location
// label at all, and a label-scoped search silently missed them — reporting
// "already there" while nothing moved.
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

  const threadIds = await findThreadsByLabelAndSender(mailProvider, email, null);

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

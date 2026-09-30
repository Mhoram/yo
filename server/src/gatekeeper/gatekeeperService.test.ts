import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeMailProvider } from '../test/FakeMailProvider.js';
import { __resetLabelCacheForTests } from '../mail-provider/labelRegistry.js';
import { getSenderApproval } from '../db/senderApprovals.js';
import {
  approveSender,
  blockSender,
  gateThreadBySender,
  listBlockedSenders,
  moveSenderToBucket,
  GATEKEEPER_BLOCKED_LABEL,
  GATEKEEPER_PENDING_LABEL,
} from './gatekeeperService.js';

// A fresh, never-seen-before sender email per test, avoiding the need to
// reset the shared SQLite instance between test cases.
function freshSender(): string {
  return `sender-${randomUUID()}@example.com`;
}

beforeEach(() => {
  __resetLabelCacheForTests();
});

describe('gateThreadBySender', () => {
  it('holds a brand-new sender as pending and strips INBOX', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email, snippet: 'hello' });

    const result = await gateThreadBySender(provider, { id: 't1', snippet: 'hello' }, { email });

    expect(result.status).toBe('pending');
    const labels = provider.threadLabels('t1');
    expect(labels).not.toContain('INBOX');
    expect(labels).toContain(provider.labelIdFor(GATEKEEPER_PENDING_LABEL));

    const approval = getSenderApproval(email);
    expect(approval?.status).toBe('pending');
    expect(approval?.first_thread_id).toBe('t1');
    expect(approval?.held_count).toBe(1);
  });

  it('gates a second thread from an already-pending sender too, bumping held_count', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    provider.addThread({ id: 't2', from: email });

    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    const result = await gateThreadBySender(provider, { id: 't2', snippet: '' }, { email });

    expect(result.status).toBe('pending');
    expect(provider.threadLabels('t2')).not.toContain('INBOX');
    expect(getSenderApproval(email)?.held_count).toBe(2);
  });

  it('lets an approved yobox sender through untouched', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    await approveSender(provider, email, 'yobox');

    provider.addThread({ id: 't2', from: email }); // a fresh thread, still has INBOX
    const before = provider.modifyCalls.length;
    const result = await gateThreadBySender(provider, { id: 't2', snippet: '' }, { email });

    expect(result).toEqual({ status: 'approved', bucket: null });
    expect(provider.threadLabels('t2')).toContain('INBOX');
    expect(provider.modifyCalls.length).toBe(before); // no label call needed for yobox
  });

  it('routes an approved receipts sender straight to that label', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    await approveSender(provider, email, 'receipts');

    provider.addThread({ id: 't2', from: email });
    const result = await gateThreadBySender(provider, { id: 't2', snippet: '' }, { email });

    expect(result).toEqual({ status: 'approved', bucket: 'receipts' });
    const labels = provider.threadLabels('t2');
    expect(labels).not.toContain('INBOX');
    expect(labels).toContain(provider.labelIdFor('App/Receipts'));
  });

  it('hides a blocked sender', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    await blockSender(provider, email);

    provider.addThread({ id: 't2', from: email });
    const result = await gateThreadBySender(provider, { id: 't2', snippet: '' }, { email });

    expect(result).toEqual({ status: 'blocked', bucket: null });
    const labels = provider.threadLabels('t2');
    expect(labels).not.toContain('INBOX');
    expect(labels).toContain(provider.labelIdFor(GATEKEEPER_BLOCKED_LABEL));
  });
});

describe('approveSender', () => {
  it('releases held threads into INBOX for yobox approval', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    provider.addThread({ id: 't2', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    await gateThreadBySender(provider, { id: 't2', snippet: '' }, { email });

    await approveSender(provider, email, 'yobox');

    expect(provider.threadLabels('t1')).toContain('INBOX');
    expect(provider.threadLabels('t2')).toContain('INBOX');
    expect(provider.threadLabels('t1')).not.toContain(provider.labelIdFor(GATEKEEPER_PENDING_LABEL));
    expect(getSenderApproval(email)?.status).toBe('approved');
    expect(getSenderApproval(email)?.bucket).toBeNull();
  });

  it('routes held threads to a bucket label, not INBOX, for non-yobox approval', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });

    await approveSender(provider, email, 'feed');

    const labels = provider.threadLabels('t1');
    expect(labels).not.toContain('INBOX');
    expect(labels).toContain(provider.labelIdFor('App/Feed'));
    expect(getSenderApproval(email)?.bucket).toBe('feed');
  });
});

describe('blockSender', () => {
  it('relabels held threads to blocked and clears pending/INBOX', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });

    await blockSender(provider, email);

    const labels = provider.threadLabels('t1');
    expect(labels).toContain(provider.labelIdFor(GATEKEEPER_BLOCKED_LABEL));
    expect(labels).not.toContain('INBOX');
    expect(labels).not.toContain(provider.labelIdFor(GATEKEEPER_PENDING_LABEL));
    expect(getSenderApproval(email)?.status).toBe('blocked');
  });

  it('surfaces the sender in listBlockedSenders', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });

    await blockSender(provider, email);

    const blocked = listBlockedSenders();
    expect(blocked.map((s) => s.sender_email)).toContain(email);
  });
});

describe('moveSenderToBucket', () => {
  it('moves an approved yobox sender to receipts, relabeling their INBOX thread', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    await approveSender(provider, email, 'yobox');

    const result = await moveSenderToBucket(provider, email, 'receipts');

    expect(result.movedThreadIds).toEqual(['t1']);
    const labels = provider.threadLabels('t1');
    expect(labels).not.toContain('INBOX');
    expect(labels).toContain(provider.labelIdFor('App/Receipts'));
    expect(getSenderApproval(email)?.bucket).toBe('receipts');
  });

  it('moves between two non-yobox buckets without touching INBOX', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    await approveSender(provider, email, 'receipts');

    const result = await moveSenderToBucket(provider, email, 'feed');

    expect(result.movedThreadIds).toEqual(['t1']);
    const labels = provider.threadLabels('t1');
    expect(labels).not.toContain(provider.labelIdFor('App/Receipts'));
    expect(labels).toContain(provider.labelIdFor('App/Feed'));
    expect(labels).not.toContain('INBOX');
  });

  it('is a no-op when moving to the bucket the sender is already in', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    await approveSender(provider, email, 'feed');
    const callsBefore = provider.modifyCalls.length;

    const result = await moveSenderToBucket(provider, email, 'feed');

    expect(result.movedThreadIds).toEqual([]);
    expect(provider.modifyCalls.length).toBe(callsBefore);
  });

  it('moving a pending sender approves them into the target bucket', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email }); // now pending

    const { movedThreadIds } = await moveSenderToBucket(provider, email, 'feed');
    expect(movedThreadIds).toEqual(['t1']);
    const approval = getSenderApproval(email);
    expect(approval?.status).toBe('approved');
    expect(approval?.bucket).toBe('feed');
    // Released from the pending label into the bucket label.
    expect(provider.threadLabels('t1')).toContain(provider.labelIdFor('App/Feed')!);
    expect(provider.threadLabels('t1')).not.toContain(provider.labelIdFor(GATEKEEPER_PENDING_LABEL)!);
  });

  it('moving an unknown sender (never gated) approves them too', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    const { movedThreadIds } = await moveSenderToBucket(provider, email, 'yobox');
    expect(movedThreadIds).toEqual([]);
    expect(getSenderApproval(email)?.status).toBe('approved');
  });

  it('still refuses to move a blocked sender', async () => {
    const provider = new FakeMailProvider();
    const email = freshSender();
    provider.addThread({ id: 't1', from: email });
    await gateThreadBySender(provider, { id: 't1', snippet: '' }, { email });
    await blockSender(provider, email);

    await expect(moveSenderToBucket(provider, email, 'feed')).rejects.toThrow(/blocked/);
  });
});

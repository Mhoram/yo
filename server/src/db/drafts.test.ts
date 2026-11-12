import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDraft, findDraftForThread, listDrafts, saveDraft } from './drafts.js';

beforeEach(() => {
  // In-memory SQLite under vitest; empty between tests via table wipe.
  listDrafts().forEach((d) => deleteDraft(d.id));
});

describe('drafts', () => {
  it('saves and lists a compose draft', () => {
    const draft = saveDraft(undefined, { kind: 'compose', to: 'a@b.c', subject: 'Hi', bodyText: 'Hello' });
    expect(listDrafts()).toHaveLength(1);
    expect(listDrafts()[0].subject).toBe('Hi');
    expect(draft.id).toBeGreaterThan(0);
  });

  it('updates in place when given the draft id', () => {
    const draft = saveDraft(undefined, { kind: 'compose', subject: 'v1' });
    const updated = saveDraft(draft.id, { kind: 'compose', subject: 'v2' });
    expect(updated.id).toBe(draft.id);
    expect(listDrafts()).toHaveLength(1);
    expect(listDrafts()[0].subject).toBe('v2');
  });

  it('inserts instead of losing content when the id no longer exists', () => {
    const draft = saveDraft(undefined, { kind: 'compose', subject: 'v1' });
    deleteDraft(draft.id);
    const updated = saveDraft(draft.id, { kind: 'compose', subject: 'v2' });
    expect(updated.id).not.toBe(draft.id);
    expect(listDrafts()).toHaveLength(1);
  });

  it('finds the latest reply draft for a thread', () => {
    saveDraft(undefined, { kind: 'reply', threadId: 't1', bodyText: 'older' });
    saveDraft(undefined, { kind: 'reply', threadId: 't1', bodyText: 'newer' });
    saveDraft(undefined, { kind: 'forward', threadId: 't1', bodyText: 'fwd' });
    const found = findDraftForThread('t1', 'reply');
    expect(found?.body_text).toBe('newer');
    expect(findDraftForThread('t1', 'forward')?.body_text).toBe('fwd');
    expect(findDraftForThread('t2', 'reply')).toBeUndefined();
  });

  it('stores and round-trips attachment payloads', () => {
    const attachments = [{ filename: 'a.pdf', contentBase64: 'AAAA', contentType: 'application/pdf' }];
    saveDraft(undefined, { kind: 'compose', attachmentsJson: JSON.stringify(attachments) });
    const stored = JSON.parse(listDrafts()[0].attachments_json!);
    expect(stored).toEqual(attachments);
  });

  it('deletes', () => {
    const draft = saveDraft(undefined, { kind: 'compose' });
    expect(deleteDraft(draft.id)).toBe(true);
    expect(deleteDraft(draft.id)).toBe(false);
    expect(listDrafts()).toHaveLength(0);
  });
});

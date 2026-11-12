import { db } from './database.js';

export type DraftKind = 'compose' | 'reply' | 'forward';

export interface DraftRow {
  id: number;
  kind: DraftKind;
  thread_id: string | null;
  to_addrs: string;
  cc_addrs: string;
  bcc_addrs: string;
  subject: string;
  body_html: string;
  body_text: string;
  reply_all: number;
  attachments_json: string | null;
  updated_at: string;
}

export interface DraftInput {
  kind: DraftKind;
  threadId?: string | null;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  bodyHtml?: string;
  bodyText?: string;
  replyAll?: boolean;
  /** Pre-validated attachment payload (parseAttachments output), stringified into the row. */
  attachmentsJson?: string | null;
}

const ROW_FIELDS = 'id, kind, thread_id, to_addrs, cc_addrs, bcc_addrs, subject, body_html, body_text, reply_all, attachments_json, updated_at';

export function getDraft(id: number): DraftRow | undefined {
  return db.prepare(`SELECT ${ROW_FIELDS} FROM drafts WHERE id = ?`).get(id) as DraftRow | undefined;
}

export function saveDraft(id: number | undefined, input: DraftInput): DraftRow {
  const updatedAt = new Date().toISOString();
  const params = {
    kind: input.kind,
    threadId: input.threadId ?? null,
    to: input.to ?? '',
    cc: input.cc ?? '',
    bcc: input.bcc ?? '',
    subject: input.subject ?? '',
    bodyHtml: input.bodyHtml ?? '',
    bodyText: input.bodyText ?? '',
    replyAll: input.replyAll ? 1 : 0,
    attachmentsJson: input.attachmentsJson ?? null,
    updatedAt,
  };

  if (id !== undefined) {
    db.prepare(
      `UPDATE drafts SET kind = @kind, thread_id = @threadId, to_addrs = @to, cc_addrs = @cc,
       bcc_addrs = @bcc, subject = @subject, body_html = @bodyHtml, body_text = @bodyText,
       reply_all = @replyAll, attachments_json = @attachmentsJson, updated_at = @updatedAt
       WHERE id = @id`,
    ).run({ ...params, id });
    const row = getDraft(id);
    if (row) return row;
    // Row vanished between list and save (deleted elsewhere): fall through
    // and insert a fresh one rather than losing the content.
  }

  const result = db
    .prepare(
      `INSERT INTO drafts (kind, thread_id, to_addrs, cc_addrs, bcc_addrs, subject, body_html, body_text, reply_all, attachments_json, updated_at)
       VALUES (@kind, @threadId, @to, @cc, @bcc, @subject, @bodyHtml, @bodyText, @replyAll, @attachmentsJson, @updatedAt)`,
    )
    .run(params);
  return getDraft(Number(result.lastInsertRowid))!;
}

/** All drafts, newest activity first. Small rows; the client gets full bodies. */
export function listDrafts(): DraftRow[] {
  return db.prepare(`SELECT ${ROW_FIELDS} FROM drafts ORDER BY updated_at DESC, id DESC`).all() as DraftRow[];
}

/** Latest draft for a thread context (reply/forward prefill). */
export function findDraftForThread(threadId: string, kind: DraftKind): DraftRow | undefined {
  return db
    .prepare(`SELECT ${ROW_FIELDS} FROM drafts WHERE thread_id = ? AND kind = ? ORDER BY updated_at DESC, id DESC LIMIT 1`)
    .get(threadId, kind) as DraftRow | undefined;
}

export function deleteDraft(id: number): boolean {
  const result = db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
  return result.changes > 0;
}

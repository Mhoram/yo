import { db } from './database.js';

export type GatekeeperStatus = 'pending' | 'approved' | 'blocked';

export interface SenderApproval {
  id: number;
  sender_email: string;
  sender_domain: string;
  display_name: string | null;
  status: GatekeeperStatus;
  first_seen_at: string;
  decided_at: string | null;
  bucket: string | null;
  first_snippet: string | null;
  first_thread_id: string | null;
  held_count: number;
}

export function getSenderApproval(email: string): SenderApproval | undefined {
  return db.prepare('SELECT * FROM sender_approvals WHERE sender_email = ?').get(email) as
    | SenderApproval
    | undefined;
}

export function insertPendingSender(params: {
  senderEmail: string;
  senderDomain: string;
  displayName: string | null;
  firstSnippet: string;
  firstThreadId: string;
}): void {
  db.prepare(
    `INSERT INTO sender_approvals (sender_email, sender_domain, display_name, status, first_seen_at, first_snippet, first_thread_id, held_count)
     VALUES (@sender_email, @sender_domain, @display_name, 'pending', @first_seen_at, @first_snippet, @first_thread_id, 0)
     ON CONFLICT(sender_email) DO NOTHING`,
  ).run({
    sender_email: params.senderEmail,
    sender_domain: params.senderDomain,
    display_name: params.displayName,
    first_seen_at: new Date().toISOString(),
    first_snippet: params.firstSnippet,
    first_thread_id: params.firstThreadId,
  });
}

export function setThreadIdIfMissing(email: string, threadId: string): void {
  db.prepare('UPDATE sender_approvals SET first_thread_id = ? WHERE sender_email = ? AND first_thread_id IS NULL').run(
    threadId,
    email,
  );
}

export function incrementHeldCount(email: string): void {
  db.prepare('UPDATE sender_approvals SET held_count = held_count + 1 WHERE sender_email = ?').run(email);
}

export function decideSender(email: string, status: 'approved' | 'blocked', bucket: string | null = null): void {
  db.prepare('UPDATE sender_approvals SET status = ?, decided_at = ?, bucket = ? WHERE sender_email = ?').run(
    status,
    new Date().toISOString(),
    bucket,
    email,
  );
}

export function listPendingSenders(): SenderApproval[] {
  return db
    .prepare("SELECT * FROM sender_approvals WHERE status = 'pending' ORDER BY first_seen_at DESC")
    .all() as SenderApproval[];
}

export function listBlockedSenders(): SenderApproval[] {
  return db
    .prepare("SELECT * FROM sender_approvals WHERE status = 'blocked' ORDER BY decided_at DESC")
    .all() as SenderApproval[];
}

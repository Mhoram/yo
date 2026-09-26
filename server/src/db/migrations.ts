// Append-only. Each entry is a single statement, safe to re-run
// (errors from "already exists" are swallowed by the runner in database.ts;
// the UPDATEs below are no-ops once applied thanks to their WHERE clauses).
export const migrations: string[] = [
  `ALTER TABLE sender_approvals ADD COLUMN first_thread_id TEXT`,
  // Rename bucket values to the app's own names (was HEY-derived vocabulary).
  `UPDATE sender_approvals SET bucket = 'yobox' WHERE bucket = 'imbox'`,
  `UPDATE sender_approvals SET bucket = 'receipts' WHERE bucket = 'paper_trail'`,
  // Contacts deep-sweep cursor (existing installs: table pre-dates the columns).
  `ALTER TABLE contacts_state ADD COLUMN page_token TEXT`,
  `ALTER TABLE contacts_state ADD COLUMN messages_scanned INTEGER NOT NULL DEFAULT 0`,
];

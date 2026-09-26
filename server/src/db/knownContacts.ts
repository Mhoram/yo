import { db } from './database.js';

export interface KnownContact {
  email: string;
  name: string | null;
}

interface KnownContactRow {
  email: string;
  name: string | null;
  use_count: number;
  last_used_at: string;
}

// touch=false is for bulk seeding (backfill, approved-sender sync): it fills
// in the address/name but leaves use_count and last_used_at alone, so a
// sender the user never actually writes to can't outrank frequent real
// recipients just because Compose was opened a lot.
export function upsertContact(email: string, name: string | null = null, touch = true): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return;

  db.prepare(
    `INSERT INTO known_contacts (email, name, use_count, last_used_at)
     VALUES (@email, @name, @bump, @now)
     ON CONFLICT(email) DO UPDATE SET
       name = COALESCE(excluded.name, known_contacts.name),
       use_count = known_contacts.use_count + @bump,
       last_used_at = CASE WHEN @touch = 1 THEN @now ELSE known_contacts.last_used_at END`,
  ).run({
    email: normalized,
    name: name?.trim() || null,
    bump: touch ? 1 : 0,
    touch: touch ? 1 : 0,
    now: new Date().toISOString(),
  });
}

// Ranked for suggestion order: recently-used first, then frequency.
export function listKnownContacts(): KnownContact[] {
  const rows = db
    .prepare('SELECT email, name FROM known_contacts ORDER BY last_used_at DESC, use_count DESC LIMIT 1000')
    .all() as KnownContactRow[];
  return rows.map((r) => ({ email: r.email, name: r.name }));
}

// Pulled in on every /api/contacts read (cheap local SQL) so newly approved
// senders start showing up as suggestions without waiting for the user to
// email them first. Never overwrites a name learned from sent-mail headers.
export function seedApprovedSenders(): void {
  const approved = db
    .prepare("SELECT sender_email, display_name FROM sender_approvals WHERE status = 'approved'")
    .all() as { sender_email: string; display_name: string | null }[];
  for (const s of approved) {
    upsertContact(s.sender_email, s.display_name, false);
  }
}

const MAX_BACKFILL_AGE_MS = 24 * 60 * 60 * 1000;

function getBackfilledAt(): string | null {
  return (db.prepare('SELECT backfilled_at FROM contacts_state WHERE id = 1').get() as
    | { backfilled_at: string | null }
    | undefined)?.backfilled_at ?? null;
}

export function isBackfillFresh(): boolean {
  const at = getBackfilledAt();
  if (!at) return false;
  return Date.now() - new Date(at).getTime() < MAX_BACKFILL_AGE_MS;
}

// Cursor for the multi-day deep sweep: null/undefined = start from the top.
export function getBackfillPageToken(): string | undefined {
  return (db.prepare('SELECT page_token FROM contacts_state WHERE id = 1').get() as
    | { page_token: string | null }
    | undefined)?.page_token ?? undefined;
}

export function setBackfillPageToken(pageToken: string | null): void {
  db.prepare('UPDATE contacts_state SET page_token = ? WHERE id = 1').run(pageToken);
}

export function markBackfilled(): void {
  db.prepare(
    `INSERT INTO contacts_state (id, backfilled_at) VALUES (1, @now)
     ON CONFLICT(id) DO UPDATE SET backfilled_at = @now`,
  ).run({ now: new Date().toISOString() });
}

// Call after a successful send so the address book learns from real traffic.
// Accepts raw recipient strings (plain emails — that's what OutgoingMessage
// carries; anything with a display name still normalizes via upsertContact).
export function recordOutgoingRecipients(groups: Array<string[] | undefined>): void {
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const email = raw.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      upsertContact(email, null, true);
    }
  }
}

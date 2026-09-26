CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date INTEGER NOT NULL,
  scope TEXT,
  token_type TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  history_id TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS sender_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_email TEXT NOT NULL UNIQUE,
  sender_domain TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'blocked')),
  first_seen_at TEXT NOT NULL,
  decided_at TEXT,
  bucket TEXT,
  first_snippet TEXT,
  held_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sender_approvals_status ON sender_approvals(status);
CREATE INDEX IF NOT EXISTS idx_sender_approvals_domain ON sender_approvals(sender_domain);

-- Cache of addresses worth suggesting in the compose To/Cc/Bcc fields:
-- harvested from recent sent + received mail headers, plus
-- gatekeeper-approved senders. Blocked senders and the user's own address
-- are excluded at seeding time.
CREATE TABLE IF NOT EXISTS known_contacts (
  email TEXT PRIMARY KEY,
  name TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL
);

-- One-row state for the contacts backfill (the only part of the contacts
-- feature that costs Gmail quota). Runs at most once per day; the page_token
-- column (added by migration, keeping schema.sql at the table's original
-- shape) resumes a multi-day deep sweep through mailbox history.
CREATE TABLE IF NOT EXISTS contacts_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  backfilled_at TEXT
);

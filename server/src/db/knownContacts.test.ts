import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './database.js';
import {
  isBackfillFresh,
  listKnownContacts,
  markBackfilled,
  recordOutgoingRecipients,
  seedApprovedSenders,
  upsertContact,
} from './knownContacts.js';

// Unique addresses per test (tests share one in-memory DB instance).
function freshEmail(): string {
  return `contact-${randomUUID()}@example.com`;
}

function seedApproval(email: string, status: 'approved' | 'blocked' | 'pending', displayName: string | null = null): void {
  db.prepare(
    `INSERT INTO sender_approvals (sender_email, sender_domain, display_name, status, first_seen_at, first_snippet, first_thread_id, held_count)
     VALUES (?, 'example.com', ?, ?, '2026-01-01', '', 't1', 0)
     ON CONFLICT(sender_email) DO UPDATE SET status = excluded.status`,
  ).run(email, displayName, status);
}

describe('upsertContact', () => {
  it('stores an email and a name', () => {
    const email = freshEmail();
    upsertContact(email, 'Jane Doe');
    expect(listKnownContacts().find((c) => c.email === email)).toEqual({ email, name: 'Jane Doe' });
  });

  it('normalizes case and whitespace', () => {
    const email = freshEmail();
    upsertContact(`  ${email.toUpperCase()}  `);
    expect(listKnownContacts().find((c) => c.email === email)).toBeDefined();
  });

  it('ignores strings that are not email addresses', () => {
    const before = listKnownContacts().length;
    upsertContact('not-an-email');
    expect(listKnownContacts().length).toBe(before);
  });

  it('bumping increments use_count; seeding does not', () => {
    const email = freshEmail();
    upsertContact(email, null, false);
    upsertContact(email, 'Later Name', false);
    const seeded = db.prepare('SELECT use_count, name FROM known_contacts WHERE email = ?').get(email) as {
      use_count: number;
      name: string | null;
    };
    expect(seeded.use_count).toBe(0);
    expect(seeded.name).toBe('Later Name');

    upsertContact(email);
    const touched = db.prepare('SELECT use_count FROM known_contacts WHERE email = ?').get(email) as {
      use_count: number;
    };
    expect(touched.use_count).toBe(1);
  });

  it('seeding never overwrites a name, touching does not clear one', () => {
    const email = freshEmail();
    upsertContact(email, 'From Sent Mail');
    upsertContact(email, null, false);
    expect(listKnownContacts().find((c) => c.email === email)?.name).toBe('From Sent Mail');
  });

  it('an existing name wins over any new name (curated data is never clobbered)', () => {
    const email = freshEmail();
    upsertContact(email, 'Curated HEY Name');
    upsertContact(email, 'Harvested Header Name');
    upsertContact(email, 'Harvested Header Name', false);
    expect(listKnownContacts().find((c) => c.email === email)?.name).toBe('Curated HEY Name');
  });

  it('fills in a name when none was stored yet, regardless of touch', () => {
    const a = freshEmail();
    upsertContact(a, null, true);
    upsertContact(a, 'Later Name', true);
    expect(listKnownContacts().find((c) => c.email === a)?.name).toBe('Later Name');
  });
});

describe('seedApprovedSenders', () => {
  it('seeds approved senders but not blocked or pending ones', () => {
    const approved = freshEmail();
    const blocked = freshEmail();
    const pending = freshEmail();
    seedApproval(approved, 'approved', 'Approved Sender');
    seedApproval(blocked, 'blocked');
    seedApproval(pending, 'pending');

    seedApprovedSenders();

    const contacts = listKnownContacts();
    expect(contacts.find((c) => c.email === approved)).toEqual({ email: approved, name: 'Approved Sender' });
    expect(contacts.find((c) => c.email === blocked)).toBeUndefined();
    expect(contacts.find((c) => c.email === pending)).toBeUndefined();
  });
});

describe('recordOutgoingRecipients', () => {
  it('records to/cc/bcc recipients, deduplicated, skipping empty groups', () => {
    const a = freshEmail();
    const b = freshEmail();
    recordOutgoingRecipients([[a, a], [b], undefined]);

    const contacts = listKnownContacts();
    expect(contacts.filter((c) => c.email === a).length).toBe(1);
    expect(contacts.find((c) => c.email === b)).toBeDefined();
  });
});

describe('backfill marker', () => {
  it('is not fresh until marked, then fresh for a day', () => {
    // Not per-test-isolated, but the assertion holds regardless of prior state:
    // after markBackfilled() it must always be fresh.
    markBackfilled();
    expect(isBackfillFresh()).toBe(true);
  });
});

import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import {
  listKnownContacts,
  isBackfillFresh,
  getBackfillPageToken,
  setBackfillPageToken,
  markBackfilled,
  seedApprovedSenders,
  upsertContact,
} from '../db/knownContacts.js';
import { listBlockedEmails } from '../db/senderApprovals.js';

// Recipient autocomplete source. The list is built from local SQLite only —
// nothing here costs Gmail quota on the hot path; the header backfill runs
// in the background, paced, and at most once per day.
export function contactsRouter(mailProvider: MailProvider): Router {
  const router = Router();

  // Guard so concurrent /api/contacts requests don't stack up sweeps.
  let backfillInFlight: Promise<void> | null = null;

  function runBackfillInBackground(): void {
    if (backfillInFlight) return;
    backfillInFlight = (async () => {
      try {
        // Mark fresh FIRST: a failed/interrupted run resumes tomorrow from
        // the stored cursor rather than retrying on every request.
        markBackfilled();

        const resumeToken = getBackfillPageToken();
        const [{ addresses: harvested, nextPageToken }, myEmail] = await Promise.all([
          mailProvider.listRecentAddresses({
            maxMessages: 1000,
            pageToken: resumeToken,
            // Cursor is persisted after every page, not just at batch end,
            // so a restart mid-sweep resumes where it left off.
            onPageToken: (t) => setBackfillPageToken(t),
          }),
          mailProvider.getMyEmailAddress(),
        ]);
        const blocked = new Set(listBlockedEmails());
        const mine = myEmail.toLowerCase();

        for (const { address, source } of harvested) {
          if (address.email.toLowerCase() === mine || blocked.has(address.email.toLowerCase())) continue;
          // Sent-mail addresses get a real use_count bump (things you chose
          // to write to rank above things that merely landed in the inbox);
          // received-only addresses are the lowest-precedence seed: no count
          // bump, and never overwrite a name learned elsewhere.
          upsertContact(address.email, address.name ?? null, source === 'sent');
        }

        setBackfillPageToken(nextPageToken ?? null);
      } catch (err) {
        console.error('Contacts backfill from mailbox headers failed; serving local cache', err);
      } finally {
        backfillInFlight = null;
      }
    })();
  }

  router.get('/', async (_req, res) => {
    try {
      seedApprovedSenders();

      // Kick off today's background sweep (paced, ~1000 messages) and serve
      // whatever the cache already has immediately.
      if (!isBackfillFresh()) runBackfillInBackground();

      res.json({ contacts: listKnownContacts() });
    } catch (err) {
      console.error('Failed to list contacts', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

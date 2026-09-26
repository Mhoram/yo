import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import {
  listKnownContacts,
  isBackfillFresh,
  markBackfilled,
  seedApprovedSenders,
  upsertContact,
} from '../db/knownContacts.js';
import { listBlockedEmails } from '../db/senderApprovals.js';

// Recipient autocomplete source. The list is built from local SQLite only —
// nothing here costs Gmail quota on the hot path except the (daily, capped)
// sent-mail backfill, and typing filters what the client already has.
export function contactsRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      seedApprovedSenders();

      // One-time-ish backfill from mailbox headers (sent + received). If
      // Gmail fails (offline, quota, revoked token), still serve whatever
      // the local cache has rather than erroring the compose page's
      // autocomplete.
      if (!isBackfillFresh()) {
        try {
          const [harvested, myEmail] = await Promise.all([
            mailProvider.listRecentAddresses(1000),
            mailProvider.getMyEmailAddress(),
          ]);
          const blocked = new Set(listBlockedEmails());
          const mine = myEmail.toLowerCase();

          for (const { address, source } of harvested) {
            if (address.email.toLowerCase() === mine || blocked.has(address.email.toLowerCase())) continue;
            // Sent-mail addresses get a real use_count bump (things you chose
            // to write to rank above things that merely landed in the
            // inbox); received-only addresses are the lowest-precedence
            // seed: no count bump, and never overwrite a name learned
            // elsewhere.
            upsertContact(address.email, address.name ?? null, source === 'sent');
          }
          markBackfilled();
        } catch (err) {
          console.error('Contacts backfill from mailbox headers failed; serving local cache', err);
        }
      }

      res.json({ contacts: listKnownContacts() });
    } catch (err) {
      console.error('Failed to list contacts', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

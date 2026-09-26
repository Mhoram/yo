import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import {
  listKnownContacts,
  isBackfillFresh,
  markBackfilled,
  seedApprovedSenders,
  upsertContact,
} from '../db/knownContacts.js';

// Recipient autocomplete source. The list is built from local SQLite only —
// nothing here costs Gmail quota on the hot path except the (daily, capped)
// sent-mail backfill, and typing filters what the client already has.
export function contactsRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      seedApprovedSenders();

      // One-time-ish backfill from the user's sent mail. If Gmail fails
      // (offline, quota, revoked token), still serve whatever the local
      // cache has rather than erroring the compose page's autocomplete.
      if (!isBackfillFresh()) {
        try {
          const recipients = await mailProvider.listSentRecipients(300);
          for (const r of recipients) {
            // Lowest-precedence seed: don't bump counts or touch recency,
            // and never overwrite a name already learned elsewhere.
            upsertContact(r.email, r.name ?? null, false);
          }
          markBackfilled();
        } catch (err) {
          console.error('Contacts backfill from sent mail failed; serving local cache', err);
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

import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { moveSenderToBucket, VALID_BUCKETS, type ApprovalBucket } from '../gatekeeper/gatekeeperService.js';
import { lookupBimiLogo } from '../lib/bimiLookup.js';

export function sendersRouter(mailProvider: MailProvider): Router {
  const router = Router();

  // BIMI-sourced sender logo (see server/src/lib/bimiLookup.ts); logoUrl is
  // null, not an error, for the (vast majority of) senders with no BIMI
  // record, so the client just falls back to its initials avatar.
  router.get('/:email/logo', async (req, res) => {
    try {
      const logoUrl = await lookupBimiLogo(req.params.email.toLowerCase());
      res.json({ logoUrl });
    } catch (err) {
      console.error('Failed to look up sender logo', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:email/bucket', async (req, res) => {
    try {
      const bucket = req.body?.bucket as ApprovalBucket | undefined;
      if (!bucket || !VALID_BUCKETS.includes(bucket)) {
        res.status(400).json({ error: `bucket must be one of ${VALID_BUCKETS.join(', ')}` });
        return;
      }
      const result = await moveSenderToBucket(mailProvider, req.params.email.toLowerCase(), bucket);
      res.json(result);
    } catch (err) {
      console.error('Failed to move sender bucket', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

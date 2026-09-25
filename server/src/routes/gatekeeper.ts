import { Router } from 'express';
import { plainTextSnippet } from '../lib/plainTextSnippet.js';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import {
  approveSender,
  blockSender,
  listBlockedSenders,
  listPendingSenders,
  VALID_BUCKETS,
  type ApprovalBucket,
} from '../gatekeeper/gatekeeperService.js';

export function gatekeeperRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const pending = listPendingSenders();
    res.json({
      senders: pending.map((s) => ({
        email: s.sender_email,
        displayName: s.display_name,
        snippet: plainTextSnippet(s.first_snippet ?? ''),
        heldCount: s.held_count,
        firstSeenAt: s.first_seen_at,
        threadId: s.first_thread_id,
      })),
    });
  });

  router.get('/blocked', (_req, res) => {
    const blocked = listBlockedSenders();
    res.json({
      senders: blocked.map((s) => ({
        email: s.sender_email,
        displayName: s.display_name,
        snippet: plainTextSnippet(s.first_snippet ?? ''),
        heldCount: s.held_count,
        decidedAt: s.decided_at,
        threadId: s.first_thread_id,
      })),
    });
  });

  router.post('/:email/approve', async (req, res) => {
    try {
      const bucket = (req.body?.bucket as ApprovalBucket | undefined) ?? 'yobox';
      if (!VALID_BUCKETS.includes(bucket)) {
        res.status(400).json({ error: `bucket must be one of ${VALID_BUCKETS.join(', ')}` });
        return;
      }
      await approveSender(mailProvider, req.params.email.toLowerCase(), bucket);
      res.status(204).end();
    } catch (err) {
      console.error('Failed to approve sender', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:email/block', async (req, res) => {
    try {
      await blockSender(mailProvider, req.params.email.toLowerCase());
      res.status(204).end();
    } catch (err) {
      console.error('Failed to block sender', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

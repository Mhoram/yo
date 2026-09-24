import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { buildThreadSummary } from '../lib/threadSummary.js';

// Deliberately delegates straight to Gmail's own search (the `q` param on
// threads.list) rather than building any local search index. Gmail's
// search is already good, and a personal mailbox's worth of threads isn't
// worth re-indexing. Search results are NOT run through Gatekeeper gating:
// gating governs what surfaces unsolicited in Yobox, not what an explicit
// "find this" action is allowed to return. A blocked or still-pending
// sender's mail should still be findable if you go looking for it.
export function searchRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q) {
        res.status(400).json({ error: 'q is required' });
        return;
      }
      const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
      const requestedLimit = Number(req.query.limit);
      const maxResults = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, requestedLimit)) : 20;

      const { threadIds, nextPageToken } = await mailProvider.listThreadIds({ q, pageToken, maxResults });
      const threads = await mapWithConcurrency(threadIds, 5, (id) => mailProvider.getThread(id, { full: false }));

      res.json({ threads: threads.map(buildThreadSummary), nextPageToken });
    } catch (err) {
      console.error('Failed to search threads', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { BUCKET_LABELS } from '../gatekeeper/gatekeeperService.js';
import { ensureLabel } from '../mail-provider/labelRegistry.js';

export interface BoxCount {
  key: 'yobox' | 'receipts' | 'feed';
  unread: number;
  // True when unread hit the one-page cap and more lie beyond it, so the
  // client can render "15+" instead of implying the count is exact.
  unreadCapped: boolean;
}

// Unread badges for the box switcher. Deliberately NOT Gmail's per-label
// unread counters (labels.get): those count the entire unread backlog in
// the mailbox (tens of thousands on a long-lived account), which is noise
// as a badge. Each badge instead counts unread threads from the last
// BADGE_WINDOW_DAYS days — recent enough to be actionable, and it ignores
// the pre-yo backlog entirely. BADGE_CAP keeps even a post-holiday pile
// from rendering an absurd number. One threads.list per box, cached
// client-side for 30s. The Gatekeeper count already comes from the local
// pending-senders list, not Gmail.
const BADGE_WINDOW_DAYS = 7;
const BADGE_CAP = 99;

export function boxesRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      // Match labels by ID, not name: system label IDs are language-
      // independent constants (INBOX is always 'INBOX'), and the buckets'
      // IDs come straight from the label registry.
      const [receiptsId, feedId] = await Promise.all([
        ensureLabel(mailProvider, BUCKET_LABELS.receipts),
        ensureLabel(mailProvider, BUCKET_LABELS.feed),
      ]);
      const recentUnread = async (labelId: string) => {
        // Fetch one past the cap so "more than cap" is distinguishable
        // without paging.
        const { threadIds } = await mailProvider.listThreadIds({
          label: labelId,
          q: `is:unread newer_than:${BADGE_WINDOW_DAYS}d`,
          maxResults: BADGE_CAP + 1,
        });
        return { unread: Math.min(threadIds.length, BADGE_CAP), unreadCapped: threadIds.length > BADGE_CAP };
      };
      const [yobox, receipts, feed] = await Promise.all([
        recentUnread('INBOX'),
        recentUnread(receiptsId),
        recentUnread(feedId),
      ]);

      const boxes: BoxCount[] = [
        { key: 'yobox', ...yobox },
        { key: 'receipts', ...receipts },
        { key: 'feed', ...feed },
      ];
      res.json({ boxes });
    } catch (err) {
      console.error('Failed to read box counts', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

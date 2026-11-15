import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { BUCKET_LABELS, GATEKEEPER_PENDING_LABEL, GATEKEEPER_BLOCKED_LABEL } from '../gatekeeper/gatekeeperService.js';
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
// Exported because "mark all as read" sweeps exactly this window — the
// button and the badge must always agree on what "all" means.
export const BADGE_WINDOW_DAYS = 7;
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
      const recentUnread = async (labelId: string, extraQuery = '') => {
        // Fetch one past the cap so "more than cap" is distinguishable
        // without paging.
        const { threadIds } = await mailProvider.listThreadIds({
          label: labelId,
          q: `is:unread newer_than:${BADGE_WINDOW_DAYS}d${extraQuery}`,
          maxResults: BADGE_CAP + 1,
        });
        return { unread: Math.min(threadIds.length, BADGE_CAP), unreadCapped: threadIds.length > BADGE_CAP };
      };
      // Yobox's badge must match what the Yobox LIST shows, and the list
      // hides more than raw INBOX: gateThreadBySender pulls unknown senders'
      // mail into the Gatekeeper queue (App/Gatekeeper-Pending, still INBOX
      // until filed), hides blocked senders, and approved senders filed to
      // Receipts/Feed briefly keep INBOX before their label move lands.
      // Counting raw INBOX unread therefore counts mail Yobox will never
      // show. The -in: exclusions align the badge with the list's gating.
      // Quote labels containing spaces — a future "App/My Feed" label must
      // not fall apart into a broken query.
      const quoteLabel = (label: string) => (label.includes(' ') ? `"${label}"` : label);
      const YOBOX_EXCLUSIONS = [
        GATEKEEPER_PENDING_LABEL,
        GATEKEEPER_BLOCKED_LABEL,
        BUCKET_LABELS.receipts,
        BUCKET_LABELS.feed,
      ]
        .map((label) => ` -in:${quoteLabel(label)}`)
        .join('');
      const [yobox, receipts, feed] = await Promise.all([
        recentUnread('INBOX', YOBOX_EXCLUSIONS),
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

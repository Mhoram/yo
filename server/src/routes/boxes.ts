import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { BUCKET_LABELS } from '../gatekeeper/gatekeeperService.js';
import { ensureLabel } from '../mail-provider/labelRegistry.js';

export interface BoxCount {
  key: 'yobox' | 'receipts' | 'feed';
  unread: number;
}

// Unread counts for the box switcher. One labels.list call (1 quota unit)
// covers every box: Gmail's label objects carry their own unread counters,
// and Yobox is just the INBOX label. The Gatekeeper count already comes
// from the local pending-senders list, not Gmail.
export function boxesRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const labels = await mailProvider.listLabels();
      // Match labels by ID, not name: system label IDs are language-
      // independent constants (INBOX is always 'INBOX'), and the buckets'
      // IDs come straight from the label registry.
      const unreadById = new Map(labels.map((l) => [l.id, l.messagesUnread ?? 0]));
      const [receiptsId, feedId] = await Promise.all([
        ensureLabel(mailProvider, BUCKET_LABELS.receipts),
        ensureLabel(mailProvider, BUCKET_LABELS.feed),
      ]);

      const boxes: BoxCount[] = [
        { key: 'yobox', unread: unreadById.get('INBOX') ?? 0 },
        { key: 'receipts', unread: unreadById.get(receiptsId) ?? 0 },
        { key: 'feed', unread: unreadById.get(feedId) ?? 0 },
      ];
      res.json({ boxes });
    } catch (err) {
      console.error('Failed to read box counts', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

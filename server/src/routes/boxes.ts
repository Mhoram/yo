import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { BUCKET_LABELS } from '../gatekeeper/gatekeeperService.js';

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
      const unreadByName = new Map(labels.map((l) => [l.name, l.messagesUnread ?? 0]));

      const boxes: BoxCount[] = [
        { key: 'yobox', unread: unreadByName.get('INBOX') ?? 0 },
        { key: 'receipts', unread: unreadByName.get(BUCKET_LABELS.receipts) ?? 0 },
        { key: 'feed', unread: unreadByName.get(BUCKET_LABELS.feed) ?? 0 },
      ];
      res.json({ boxes });
    } catch (err) {
      console.error('Failed to read box counts', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

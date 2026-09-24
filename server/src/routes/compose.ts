import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { parseAttachments } from '../lib/attachments.js';

export function composeRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const { to, cc, subject, bodyText, bodyHtml, attachments: rawAttachments } = req.body ?? {};
      if (!Array.isArray(to) || to.length === 0 || to.some((t) => typeof t !== 'string')) {
        res.status(400).json({ error: 'to must be a non-empty array of email address strings' });
        return;
      }
      if (typeof subject !== 'string' || subject.trim().length === 0) {
        res.status(400).json({ error: 'subject is required' });
        return;
      }
      if (typeof bodyText !== 'string' || bodyText.trim().length === 0) {
        res.status(400).json({ error: 'bodyText is required' });
        return;
      }

      const { attachments, error: attachmentsError } = parseAttachments(rawAttachments);
      if (attachmentsError) {
        res.status(400).json({ error: attachmentsError });
        return;
      }

      const result = await mailProvider.sendMessage({
        to,
        cc: Array.isArray(cc) && cc.length > 0 ? cc.filter((c): c is string => typeof c === 'string') : undefined,
        subject,
        bodyText,
        bodyHtml: typeof bodyHtml === 'string' ? bodyHtml : undefined,
        attachments,
      });
      res.json(result);
    } catch (err) {
      console.error('Failed to send composed message', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

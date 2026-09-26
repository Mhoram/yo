import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { parseAttachments } from '../lib/attachments.js';
import { recordOutgoingRecipients } from '../db/knownContacts.js';

export function composeRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const { to, cc, bcc, subject, bodyText, bodyHtml, attachments: rawAttachments } = req.body ?? {};
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

      const ccList = Array.isArray(cc) && cc.length > 0 ? cc.filter((c): c is string => typeof c === 'string') : undefined;
      const bccList =
        Array.isArray(bcc) && bcc.length > 0 ? bcc.filter((b): b is string => typeof b === 'string') : undefined;

      const result = await mailProvider.sendMessage({
        to,
        cc: ccList,
        bcc: bccList,
        subject,
        bodyText,
        bodyHtml: typeof bodyHtml === 'string' ? bodyHtml : undefined,
        attachments,
      });

      // Learn the addresses just used so they rank up in autocomplete.
      recordOutgoingRecipients([to, ccList, bccList]);

      res.json(result);
    } catch (err) {
      console.error('Failed to send composed message', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

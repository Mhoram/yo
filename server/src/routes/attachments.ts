import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';

export function attachmentsRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/:messageId/:attachmentId', async (req, res) => {
    try {
      const { data, mimeType, filename } = await mailProvider.getAttachment(
        req.params.messageId,
        req.params.attachmentId,
      );
      res.setHeader('Content-Type', mimeType);
      const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.send(data);
    } catch (err) {
      console.error('Failed to download attachment', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

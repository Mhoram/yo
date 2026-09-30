import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';

export function attachmentsRouter(mailProvider: MailProvider): Router {
  const router = Router();

  // Mime types that may render INSIDE the app (viewer modal / <iframe>).
  // Everything else — especially text/html and image/svg+xml, which would
  // be stored XSS if rendered inline on our origin — downloads instead.
  // Browser sniffing is pinned off with nosniff so a mislabeled payload
  // can't sneak into a renderable type.
  const INLINE_MIME = /^(application\/pdf|image\/|video\/|audio\/|text\/plain)/;

  router.get('/:messageId/:attachmentId', async (req, res) => {
    try {
      const { data, mimeType, filename } = await mailProvider.getAttachment(
        req.params.messageId,
        req.params.attachmentId,
      );
      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const inline = req.query.inline === '1' && INLINE_MIME.test(mimeType);
      if (inline) {
        res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/["\\\r\n]/g, '_')}"`);
      }
      const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      if (!inline) {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        );
      }
      res.send(data);
    } catch (err) {
      console.error('Failed to download attachment', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

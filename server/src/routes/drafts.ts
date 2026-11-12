import { Router } from 'express';
import { parseAttachments } from '../lib/attachments.js';
import { deleteDraft, findDraftForThread, getDraft, listDrafts, saveDraft, type DraftKind } from '../db/drafts.js';

const KINDS: DraftKind[] = ['compose', 'reply', 'forward'];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function draftsRouter(): Router {
  const router = Router();

  // Two shapes on purpose:
  // - GET /api/drafts → every draft (box-menu count + drafts page)
  // - GET /api/drafts?threadId=..&kind=reply|forward → the one draft for that
  //   compose context, so reopening a thread pre-fills the compose box
  router.get('/', (req, res) => {
    const { threadId, kind } = req.query;
    if (typeof threadId === 'string' && threadId.length > 0) {
      if (kind !== 'reply' && kind !== 'forward') {
        res.status(400).json({ error: 'kind must be reply or forward when threadId is given' });
        return;
      }
      res.json({ draft: findDraftForThread(threadId, kind) ?? null });
      return;
    }
    res.json({ drafts: listDrafts() });
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'id must be an integer' });
      return;
    }
    const draft = getDraft(id);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.json({ draft });
  });

  router.post('/', (req, res) => {
    const body = req.body ?? {};
    const kind = body.kind;
    if (!KINDS.includes(kind)) {
      res.status(400).json({ error: 'kind must be one of compose, reply, forward' });
      return;
    }
    for (const field of ['to', 'cc', 'bcc', 'subject', 'bodyHtml', 'bodyText'] as const) {
      const value = body[field];
      if (value !== undefined && typeof value !== 'string') {
        res.status(400).json({ error: `${field} must be a string` });
        return;
      }
    }
    if (body.replyAll !== undefined && typeof body.replyAll !== 'boolean') {
      res.status(400).json({ error: 'replyAll must be a boolean' });
      return;
    }
    if (body.threadId !== undefined && body.threadId !== null && typeof body.threadId !== 'string') {
      res.status(400).json({ error: 'threadId must be a string' });
      return;
    }

    // Same validation (and 25MB cap) as the send path, since a saved draft
    // becomes a send body later.
    const { attachments, error: attachmentsError } = parseAttachments(body.attachments);
    if (attachmentsError) {
      res.status(400).json({ error: attachmentsError });
      return;
    }

    const id = typeof body.id === 'number' ? body.id : undefined;
    const draft = saveDraft(id, {
      kind,
      threadId: asString(body.threadId) ?? null,
      to: asString(body.to),
      cc: asString(body.cc),
      bcc: asString(body.bcc),
      subject: asString(body.subject),
      bodyHtml: asString(body.bodyHtml),
      bodyText: asString(body.bodyText),
      replyAll: body.replyAll === true,
      attachmentsJson: attachments ? JSON.stringify(attachments) : null,
    });
    res.json({ draft });
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'id must be an integer' });
      return;
    }
    res.json({ deleted: deleteDraft(id) });
  });

  return router;
}

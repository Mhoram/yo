import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { sanitizeEmailHtml } from '../lib/sanitizeEmailHtml.js';
import { gateThreadBySender, BUCKET_LABELS } from '../gatekeeper/gatekeeperService.js';
import { ensureLabel } from '../mail-provider/labelRegistry.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { buildReplyEnvelope } from '../lib/replyEnvelope.js';
import { buildForwardEnvelope } from '../lib/forwardEnvelope.js';
import { parseAttachments } from '../lib/attachments.js';
import { buildThreadSummary } from '../lib/threadSummary.js';

export function threadsRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const requestedLabel = typeof req.query.label === 'string' ? req.query.label : 'INBOX';
      let pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;

      // Bucket views (Receipts / Feed) are addressed by our own friendly
      // keys: custom Gmail labels need their real (opaque) label ID, not
      // their display name, to filter threads.list.
      const bucketLabelName = BUCKET_LABELS[requestedLabel];
      const label = bucketLabelName ? await ensureLabel(mailProvider, bucketLabelName) : requestedLabel;

      // Gatekeeper/bucket gating means a whole page of INBOX threads can come
      // back entirely filtered out (e.g. right after a bulk import of
      // sender decisions), so keep paging Gmail until we actually have some
      // visible mail to show, instead of returning an empty page. Bounded
      // so one request can't run away against a huge backlog.
      const TARGET_VISIBLE = 15;
      // Gmail page size kept small too: worst case (every thread in a page
      // is a fresh gate transition, needing a get + a label-modify call) is
      // ~50 quota units/thread, so a page of 25 alone can cost ~1,250 units.
      // At 15/page * 2 pages that worst case drops to ~1,500 total instead
      // of ~2,500. This matters because infinite-scroll can trigger several
      // of these page requests in quick succession while a user scrolls, and
      // retries are disabled client-side but a prior failed attempt can
      // still leave the per-minute window partly used up. See also the
      // client-side scroll cooldown in ThreadList.tsx, which caps how often
      // these requests can fire at all.
      const GMAIL_PAGE_SIZE = 15;
      const MAX_PAGES = 2;

      const visibleThreads: Awaited<ReturnType<typeof mailProvider.getThread>>[] = [];
      let nextPageToken: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        const listResult = await mailProvider.listThreadIds({ label, pageToken, maxResults: GMAIL_PAGE_SIZE });
        nextPageToken = listResult.nextPageToken;

        const threads = await mapWithConcurrency(listResult.threadIds, 5, (id) =>
          mailProvider.getThread(id, { full: false }),
        );

        if (label === 'INBOX') {
          const gated = await mapWithConcurrency(threads, 5, async (thread) => {
            const last = thread.messages.at(-1);
            if (!last) return null;
            const gate = await gateThreadBySender(
              mailProvider,
              { id: thread.id, snippet: last.snippet || thread.snippet },
              last.from,
            );
            const isYobox = gate.bucket === null || gate.bucket === 'yobox';
            return gate.status === 'approved' && isYobox ? thread : null;
          });
          visibleThreads.push(...gated.filter((t): t is NonNullable<typeof t> => t !== null));
        } else {
          visibleThreads.push(...threads);
        }

        pageToken = nextPageToken;
        if (visibleThreads.length >= TARGET_VISIBLE || !pageToken) break;
      }

      const summaries = visibleThreads.map(buildThreadSummary);

      res.json({ threads: summaries, nextPageToken });
    } catch (err) {
      console.error('Failed to list threads', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Bulk "mark as seen" for the New-for-you section. Scoped to whatever the
  // client currently has loaded (bounded by infinite-scroll pages already
  // fetched), never an unbounded full-mailbox sweep, and capped again
  // here server-side as a defensive limit regardless of what's sent.
  const MAX_MARK_SEEN = 200;
  router.post('/mark-seen', async (req, res) => {
    try {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        res.status(400).json({ error: 'ids must be an array of thread id strings' });
        return;
      }
      const capped = ids.slice(0, MAX_MARK_SEEN);
      await mapWithConcurrency(capped, 5, (id) => mailProvider.modifyThreadLabels(id, { remove: ['UNREAD'] }));
      res.json({ markedThreadIds: capped });
    } catch (err) {
      console.error('Failed to mark threads seen', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Resolves the two bucket label IDs once per request; used by both
  // archive and trash, which both need to strip a thread out of wherever
  // it currently sits (Yobox/Receipts/Feed) regardless of which one.
  async function locationLabelIds(): Promise<string[]> {
    const [paperTrailId, feedId] = await Promise.all([
      ensureLabel(mailProvider, BUCKET_LABELS.receipts),
      ensureLabel(mailProvider, BUCKET_LABELS.feed),
    ]);
    return ['INBOX', paperTrailId, feedId];
  }

  router.post('/:id/archive', async (req, res) => {
    try {
      const remove = await locationLabelIds();
      await mailProvider.modifyThreadLabels(req.params.id, { remove });
      res.status(204).end();
    } catch (err) {
      console.error('Failed to archive thread', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/trash', async (req, res) => {
    try {
      const location = await locationLabelIds();
      await mailProvider.modifyThreadLabels(req.params.id, {
        add: ['TRASH'],
        remove: [...location, 'UNREAD'],
      });
      res.status(204).end();
    } catch (err) {
      console.error('Failed to trash thread', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/unread', async (req, res) => {
    try {
      await mailProvider.modifyThreadLabels(req.params.id, { add: ['UNREAD'] });
      res.status(204).end();
    } catch (err) {
      console.error('Failed to mark thread unread', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/reply', async (req, res) => {
    try {
      const { bodyText, bodyHtml, replyAll, attachments: rawAttachments } = req.body ?? {};
      if (typeof bodyText !== 'string' || bodyText.trim().length === 0) {
        res.status(400).json({ error: 'bodyText is required' });
        return;
      }

      const { attachments, error: attachmentsError } = parseAttachments(rawAttachments);
      if (attachmentsError) {
        res.status(400).json({ error: attachmentsError });
        return;
      }

      const thread = await mailProvider.getThread(req.params.id);
      const last = thread.messages.at(-1);
      if (!last) {
        res.status(404).json({ error: 'Thread has no messages to reply to' });
        return;
      }

      const myEmail = await mailProvider.getMyEmailAddress();
      const envelope = buildReplyEnvelope(last, myEmail, Boolean(replyAll));

      const result = await mailProvider.sendMessage({
        ...envelope,
        bodyText,
        bodyHtml: typeof bodyHtml === 'string' ? bodyHtml : undefined,
        threadId: thread.id,
        attachments,
      });

      res.json(result);
    } catch (err) {
      console.error('Failed to send reply', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/forward', async (req, res) => {
    try {
      const { to, note, attachments: rawAttachments } = req.body ?? {};
      if (!Array.isArray(to) || to.length === 0 || to.some((t) => typeof t !== 'string')) {
        res.status(400).json({ error: 'to must be a non-empty array of email address strings' });
        return;
      }

      const { attachments, error: attachmentsError } = parseAttachments(rawAttachments);
      if (attachmentsError) {
        res.status(400).json({ error: attachmentsError });
        return;
      }

      const thread = await mailProvider.getThread(req.params.id);
      const last = thread.messages.at(-1);
      if (!last) {
        res.status(404).json({ error: 'Thread has no messages to forward' });
        return;
      }

      const envelope = buildForwardEnvelope(last, to, typeof note === 'string' ? note : undefined);
      const result = await mailProvider.sendMessage({ ...envelope, attachments });
      res.json(result);
    } catch (err) {
      console.error('Failed to forward thread', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const thread = await mailProvider.getThread(req.params.id);

      // Opening a thread marks it read in Gmail itself, same as opening it in
      // Gmail's own web UI. Keeps read state accurate for every client, not
      // just this app's local view of it.
      if (thread.labelIds.includes('UNREAD')) {
        await mailProvider.modifyThreadLabels(thread.id, { remove: ['UNREAD'] });
      }

      const sanitized = {
        ...thread,
        labelIds: thread.labelIds.filter((l) => l !== 'UNREAD'),
        messages: thread.messages.map((m) => ({
          ...m,
          labelIds: m.labelIds.filter((l) => l !== 'UNREAD'),
          bodyHtml: m.bodyHtml ? sanitizeEmailHtml(m.bodyHtml) : undefined,
        })),
      };
      res.json(sanitized);
    } catch (err) {
      console.error('Failed to get thread', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

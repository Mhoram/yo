import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useThread,
  useMoveSenderBucket,
  useArchiveThread,
  useTrashThread,
  useMarkThreadUnread,
  useReplyToThread,
  useForwardThread,
  type ThreadsInfiniteData,
} from '../hooks/useThreads';
import { EmailBodyFrame } from '../components/EmailBodyFrame';
import { RichTextEditor } from '../components/RichTextEditor';
import { AttachmentPicker, attachmentsToPayload, type PendingAttachment } from '../components/AttachmentPicker';
import { AttachmentViewer, type ViewingAttachment } from '../components/AttachmentViewer';
import { usePendingSenders, useGatekeeperDecision } from '../hooks/useGatekeeper';
import { formatDateTime } from '../lib/format';
import type { ApprovalBucket } from '../lib/api';

const BUCKET_OPTIONS: { bucket: ApprovalBucket; label: string }[] = [
  { bucket: 'yobox', label: 'Yobox' },
  { bucket: 'receipts', label: 'Receipts' },
  { bucket: 'feed', label: 'Feed' },
];

function ComposeBox({ threadId }: { threadId: string }) {
  const [mode, setMode] = useState<'reply' | 'forward'>('reply');
  const [replyHtml, setReplyHtml] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyAll, setReplyAll] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const reply = useReplyToThread();
  const forward = useForwardThread();

  const active = mode === 'reply' ? reply : forward;
  const forwardRecipients = forwardTo
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const attachmentPayload = attachments.length > 0 ? attachmentsToPayload(attachments) : undefined;

  function reset() {
    setReplyHtml('');
    setReplyText('');
    setForwardTo('');
    setForwardNote('');
    setAttachments([]);
    setEditorKey((k) => k + 1); // remounts the rich text editor empty
  }

  function send() {
    if (mode === 'reply') {
      reply.mutate(
        { threadId, bodyText: replyText, bodyHtml: replyHtml, replyAll, attachments: attachmentPayload },
        { onSuccess: reset },
      );
    } else {
      forward.mutate(
        { threadId, to: forwardRecipients, note: forwardNote, attachments: attachmentPayload },
        { onSuccess: reset },
      );
    }
  }

  const canSend = mode === 'reply' ? replyText.trim().length > 0 : forwardRecipients.length > 0;

  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setMode('reply')}
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            mode === 'reply' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          Reply
        </button>
        <button
          type="button"
          onClick={() => setMode('forward')}
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            mode === 'forward' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          Forward
        </button>
      </div>
      {mode === 'forward' && (
        <input
          value={forwardTo}
          onChange={(e) => setForwardTo(e.target.value)}
          placeholder="To (comma-separated email addresses)"
          className="mb-3 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      )}
      {mode === 'reply' ? (
        <RichTextEditor
          key={editorKey}
          placeholder="Write a reply..."
          onUpdate={(html, text) => {
            setReplyHtml(html);
            setReplyText(text);
          }}
        />
      ) : (
        <textarea
          value={forwardNote}
          onChange={(e) => setForwardNote(e.target.value)}
          placeholder="Add a note (optional)..."
          rows={5}
          className="w-full resize-y rounded-md border border-border bg-background p-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      )}
      <AttachmentPicker attachments={attachments} onChange={setAttachments} />
      <div className="mt-3 flex items-center justify-between gap-3">
        {mode === 'reply' ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={replyAll} onChange={(e) => setReplyAll(e.target.checked)} />
            Reply all
          </label>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={active.isPending || !canSend}
          onClick={send}
          className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {active.isPending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {active.isError && <p className="mt-2 text-sm text-red-400">{active.error.message}</p>}
      {active.isSuccess && <p className="mt-2 text-sm text-muted-foreground">Sent.</p>}
    </div>
  );
}

export function ThreadView() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useThread(id);
  const [viewing, setViewing] = useState<ViewingAttachment | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const moveSender = useMoveSenderBucket();
  const archiveThread = useArchiveThread();
  const trashThread = useTrashThread();
  const markUnread = useMarkThreadUnread();

  // Opening a thread marks it read server-side (see GET /api/threads/:id).
  // Patch that directly into the already-cached list data instead of
  // invalidating. Invalidating an infinite query re-fetches its ENTIRE
  // accumulated page chain (not just page one), and `['threads']` matches
  // Yobox/Receipts/Feed all at once, so this used to turn "open one
  // email" into a burst of Gmail calls large enough to blow the quota.
  useEffect(() => {
    if (data) {
      queryClient.setQueriesData<ThreadsInfiniteData>({ queryKey: ['threads'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            threads: page.threads.map((t) => (t.id === data.id ? { ...t, unread: false } : t)),
          })),
        };
      });
      queryClient.invalidateQueries({ queryKey: ['gatekeeper'] });
    }
  }, [data, queryClient]);

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (error || !data) {
    return <div className="p-8 text-red-400">Failed to load thread: {(error as Error)?.message}</div>;
  }

  const senderEmail = data.messages.at(-1)?.from.email;

  // A sender still held by the Gatekeeper gets different thread-view
  // actions: "Move to" doubles as approving them into that bucket (the
  // server treats moving a pending sender as a decision), and they can be
  // blocked straight from here instead of trekking back to the list.
  const { data: pendingSenders } = usePendingSenders();
  const isPendingSender = Boolean(senderEmail && pendingSenders?.senders.some((s) => s.email === senderEmail));
  const decision = useGatekeeperDecision();

  return (
    <div className="mx-auto max-w-5xl px-2 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
            &larr; Back
          </button>
          <button
            type="button"
            disabled={archiveThread.isPending}
            onClick={() => archiveThread.mutate(data.id, { onSuccess: () => navigate(-1) })}
            className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Archive
          </button>
          <button
            type="button"
            disabled={trashThread.isPending}
            onClick={() => {
              if (confirm('Move this thread to Trash?')) {
                trashThread.mutate(data.id, { onSuccess: () => navigate(-1) });
              }
            }}
            className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            disabled={markUnread.isPending}
            onClick={() => markUnread.mutate(data.id, { onSuccess: () => navigate(-1) })}
            className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Mark unread
          </button>
        </div>
        {senderEmail && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{isPendingSender ? 'Approve into:' : 'Move to:'}</span>
            {BUCKET_OPTIONS.map(({ bucket, label }) => (
              <button
                key={bucket}
                type="button"
                disabled={moveSender.isPending || decision.isPending}
                onClick={() => moveSender.mutate({ email: senderEmail, bucket })}
                className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                {label}
              </button>
            ))}
            {isPendingSender && (
              <button
                type="button"
                disabled={moveSender.isPending || decision.isPending}
                onClick={() => decision.mutate({ email: senderEmail, action: 'block' })}
                className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Block
              </button>
            )}
          </div>
        )}
      </div>
      {moveSender.isSuccess && moveSender.variables?.email === senderEmail && (
        <p className="mt-2 text-sm text-muted-foreground">
          {moveSender.data.movedThreadIds.length > 0
            ? `Moved ${moveSender.data.movedThreadIds.length} thread(s) to ${
                BUCKET_OPTIONS.find((o) => o.bucket === moveSender.variables?.bucket)?.label
              }.`
            : 'Already there.'}
        </p>
      )}
      {moveSender.isError && <p className="mt-2 text-sm text-red-400">{moveSender.error.message}</p>}
      <div className="mt-6 space-y-6">
        {data.messages.map((message) => (
          <article key={message.id} className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="p-5 pb-3">
              <h2 className="text-lg font-semibold">{message.subject}</h2>
              <p className="text-sm text-muted-foreground">
                {message.from.name ?? message.from.email} &lt;{message.from.email}&gt;
                {' · '}
                {formatDateTime(message.date)}
              </p>
            </header>
            {message.bodyHtml ? (
              <EmailBodyFrame html={message.bodyHtml} />
            ) : (
              <p className="whitespace-pre-wrap px-5 pb-5">{message.bodyText}</p>
            )}
            {message.attachments.length > 0 && (
              <div className="border-t border-border px-5 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {message.attachments.length === 1 ? 'Attachment' : `${message.attachments.length} attachments`}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {message.attachments.map((a) => {
                    const url = `/api/attachments/${message.id}/${a.attachmentId}`;
                    const isImage = a.mimeType.startsWith('image/');
                    return (
                      <li key={a.attachmentId}>
                        <button
                          type="button"
                          onClick={() => setViewing({ url, filename: a.filename, mimeType: a.mimeType, size: a.size })}
                          className="group block overflow-hidden rounded-md border border-border text-left hover:opacity-90"
                        >
                          {isImage ? (
                            <>
                              <img src={url} alt={a.filename} className="h-28 w-28 object-cover" />
                              <span className="block truncate bg-card px-2 py-1 text-xs text-muted-foreground">
                                {a.filename}
                              </span>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-foreground">
                              {a.filename}
                              <span className="text-muted-foreground">({Math.ceil(a.size / 1024)} KB)</span>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </article>
        ))}
      </div>
      <ComposeBox threadId={data.id} />
      {viewing && <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { RecipientField } from '../components/RecipientField';
import { RichTextEditor } from '../components/RichTextEditor';
import { AttachmentPicker, attachmentsToPayload, payloadToPendingAttachments, type PendingAttachment } from '../components/AttachmentPicker';
import { AttachmentViewer, type ViewingAttachment } from '../components/AttachmentViewer';
import { usePendingSenders, useGatekeeperDecision } from '../hooks/useGatekeeper';
import { useDeleteDraft, useDraftById, useDraftForThread, useSaveDraft } from '../hooks/useDrafts';
import { formatDateTime } from '../lib/format';
import type { ApprovalBucket } from '../lib/api';

const BUCKET_OPTIONS: { bucket: ApprovalBucket; label: string }[] = [
  { bucket: 'yobox', label: 'Yobox' },
  { bucket: 'receipts', label: 'Receipts' },
  { bucket: 'feed', label: 'Feed' },
];

function ComposeBox({ threadId, reopenDraftId }: { threadId: string; reopenDraftId?: number }) {
  const [mode, setMode] = useState<'reply' | 'forward'>('reply');
  const [replyHtml, setReplyHtml] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyAll, setReplyAll] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [draftId, setDraftId] = useState<number | undefined>();
  const [savingDraft, setSavingDraft] = useState(false);
  const reply = useReplyToThread();
  const forward = useForwardThread();
  const saveDraft = useSaveDraft();
  const deleteDraft = useDeleteDraft();

  // Draft prefill: either the draft explicitly reopened from the Drafts
  // page (?draft=N), or whatever was last auto-saved for this thread+mode.
  // Prefill applies once per draft id (refs), remounting the editor with
  // the saved HTML via key changes.
  const { data: reopenData } = useDraftById(reopenDraftId);
  const { data: forThreadData } = useDraftForThread(threadId, mode);
  const prefilledFor = useRef<number | null>(null);
  const reopenKind = reopenData?.draft.kind;
  useEffect(() => {
    const draft = reopenData?.draft ?? forThreadData?.draft;
    if (!draft || prefilledFor.current === draft.id) return;
    prefilledFor.current = draft.id;
    setDraftId(draft.id);
    if (reopenKind === 'forward' || (!reopenData?.draft && draft.kind === 'forward')) setMode('forward');
    if (reopenKind === 'reply' || (!reopenData?.draft && draft.kind === 'reply')) setMode('reply');
    if (draft.kind === 'forward') {
      setForwardTo(draft.to);
      setForwardNote(draft.bodyText);
    } else {
      setReplyAll(draft.replyAll);
      setReplyHtml(draft.bodyHtml);
      setReplyText(draft.bodyText);
    }
    setAttachments(payloadToPendingAttachments(draft.attachments ?? []));
    setEditorKey((k) => k + 1); // remount editor with the draft's HTML
  }, [reopenData, forThreadData, reopenKind]);

  const active = mode === 'reply' ? reply : forward;
  const forwardRecipients = forwardTo
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const attachmentPayload = attachments.length > 0 ? attachmentsToPayload(attachments) : undefined;

  // Auto-save the compose context (same debounce-and-dedupe pattern as the
  // Compose page): reply drafts keep the rich-text body, forward drafts
  // keep recipients + note. Attachments ride along in both.
  const lastSaved = useRef('');
  const draftPayload =
    mode === 'reply'
      ? { id: draftId, kind: 'reply' as const, threadId, bodyHtml: replyHtml, bodyText: replyText, replyAll, attachments: attachmentPayload }
      : { id: draftId, kind: 'forward' as const, threadId, to: forwardTo, bodyText: forwardNote, attachments: attachmentPayload };
  const hasContent =
    mode === 'reply'
      ? replyText.trim().length > 0
      : forwardRecipients.length > 0 || forwardNote.trim().length > 0;
  useEffect(() => {
    const serialized = JSON.stringify(draftPayload);
    if (!hasContent || serialized === lastSaved.current) return;
    const timer = setTimeout(() => {
      lastSaved.current = serialized;
      setSavingDraft(true);
      saveDraft.mutate(draftPayload, {
        onSuccess: ({ draft }) => setDraftId(draft.id),
        onSettled: () => setSavingDraft(false),
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [draftPayload, hasContent]);

  function reset() {
    setReplyHtml('');
    setReplyText('');
    setForwardTo('');
    setForwardNote('');
    setAttachments([]);
    setDraftId(undefined);
    prefilledFor.current = null;
    lastSaved.current = '';
    setEditorKey((k) => k + 1); // remounts the rich text editor empty
  }

  function send() {
    if (mode === 'reply') {
      reply.mutate(
        { threadId, bodyText: replyText, bodyHtml: replyHtml, replyAll, attachments: attachmentPayload },
        {
          onSuccess: () => {
            if (draftId !== undefined) deleteDraft.mutate(draftId);
            reset();
          },
        },
      );
    } else {
      forward.mutate(
        { threadId, to: forwardRecipients, note: forwardNote, attachments: attachmentPayload },
        {
          onSuccess: () => {
            if (draftId !== undefined) deleteDraft.mutate(draftId);
            reset();
          },
        },
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
        <div className="mb-3">
          {/* Same contact autocomplete as the Compose page, so recently used
              addresses are suggested here too. */}
          <RecipientField
            value={forwardTo}
            onChange={setForwardTo}
            placeholder="To (comma-separated email addresses)"
            exclude={[]}
          />
        </div>
      )}
      {mode === 'reply' ? (
        <RichTextEditor
          key={editorKey}
          initialHtml={draftId !== undefined ? replyHtml : undefined}
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
        <span className="text-xs text-muted-foreground">{savingDraft ? 'Saving draft…' : draftId !== undefined ? 'Draft saved' : ''}</span>
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
  const [searchParams] = useSearchParams();
  const reopenDraftId = searchParams.get('draft') ? Number(searchParams.get('draft')) : undefined;
  const { data, isLoading, error } = useThread(id);
  const [viewing, setViewing] = useState<ViewingAttachment | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const moveSender = useMoveSenderBucket();
  const archiveThread = useArchiveThread();
  const trashThread = useTrashThread();
  const markUnread = useMarkThreadUnread();
  // Hooks stay above the early returns below (Rules of Hooks): these run
  // unconditionally, and the values they produce are only READ after the
  // thread data has loaded.
  const { data: pendingSenders } = usePendingSenders();
  const decision = useGatekeeperDecision();

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
      // Opening an unread thread marks it read server-side (below), which
      // also changes the box switcher's unread badges — without this the
      // menu keeps showing a stale count until some other mutation
      // happens to refresh it.
      if (data.labelIds.includes('UNREAD')) {
        queryClient.invalidateQueries({ queryKey: ['boxes'] });
      }
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
  // server treats moving a pending sender as a decision). "Block" only
  // files their held mail; for an approved sender the button becomes
  // "Screen out", which sweeps ALL their mail into Screened Out — worth
  // confirming before it hides everything the sender has ever sent.
  const isPendingSender = Boolean(senderEmail && pendingSenders?.senders.some((s) => s.email === senderEmail));

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
            <button
              type="button"
              disabled={moveSender.isPending || decision.isPending}
              onClick={() => {
                if (!isPendingSender && !confirm(`Screen out ${senderEmail}? All their mail will be hidden and auto-deleted after 90 days.`)) {
                  return;
                }
                // Screening an approved sender out refiles the thread being
                // viewed, so it no longer belongs in the current box.
                decision.mutate(
                  { email: senderEmail, action: 'block' },
                  { onSuccess: () => !isPendingSender && navigate(-1) },
                );
              }}
              className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {isPendingSender ? 'Block' : 'Screen out'}
            </button>
          </div>
        )}
      </div>
      {moveSender.isSuccess && moveSender.variables?.email === senderEmail && (
        <p className="mt-2 text-sm text-muted-foreground">
          {moveSender.data.movedThreadIds.length > 0
            ? `Moved ${moveSender.data.movedThreadIds.length} conversation(s) to ${
                BUCKET_OPTIONS.find((o) => o.bucket === moveSender.variables?.bucket)?.label
              }.`
            : 'Decision updated, but no conversations were re-filed.'}
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
                  {message.attachments.map((a, partIndex) => {
                    // partIndex addresses the attachment server-side; Gmail
                    // rotates attachment IDs, so the ID alone mislabels the
                    // response (octet-stream + "attachment").
                    const url = `/api/attachments/${message.id}/${a.attachmentId}?part=${partIndex}`;
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
      <ComposeBox threadId={data.id} reopenDraftId={Number.isInteger(reopenDraftId) ? reopenDraftId : undefined} />
      {viewing && <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

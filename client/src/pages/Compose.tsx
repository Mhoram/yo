import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { RichTextEditor } from '../components/RichTextEditor';
import { AttachmentPicker, attachmentsToPayload, payloadToPendingAttachments, type PendingAttachment } from '../components/AttachmentPicker';
import { RecipientField } from '../components/RecipientField';
import { useComposeMessage } from '../hooks/useCompose';
import { useDeleteDraft, useDraftById, useSaveDraft } from '../hooks/useDrafts';
import type { Draft } from '../lib/api';

function parseEmailList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

const fieldClass =
  'w-full rounded-md border border-border bg-background p-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary';

export function Compose() {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [draftId, setDraftId] = useState<number | undefined>();
  const [savingDraft, setSavingDraft] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const compose = useComposeMessage();
  const saveDraft = useSaveDraft();
  const deleteDraft = useDeleteDraft();

  // Reopening a saved draft: /compose?draft=N pre-fills the form once. The
  // attachment payload round-trips through File objects so the picker (and
  // the send path) treat restored and freshly-picked files identically.
  const prefillDraftId = searchParams.get('draft');
  const { data: prefillData } = useDraftById(prefillDraftId ? Number(prefillDraftId) : undefined);
  const prefilledFor = useRef<number | null>(null);
  useEffect(() => {
    const draft: Draft | undefined = prefillData?.draft;
    if (!draft || prefilledFor.current === draft.id) return;
    prefilledFor.current = draft.id;
    setDraftId(draft.id);
    setTo(draft.to);
    setCc(draft.cc);
    setBcc(draft.bcc);
    setSubject(draft.subject);
    setBodyHtml(draft.bodyHtml);
    setBodyText(draft.bodyText);
    setAttachments(payloadToPendingAttachments(draft.attachments ?? []));
  }, [prefillData]);

  // Auto-save: 2s after the last change to any draft-relevant field, as
  // long as there's something worth saving and the content actually moved
  // since the last save (otherwise every keystroke round-trips).
  const lastSaved = useRef('');
  const draftPayload = {
    id: draftId,
    kind: 'compose' as const,
    to,
    cc,
    bcc,
    subject,
    bodyHtml,
    bodyText,
    attachments: attachments.length > 0 ? attachmentsToPayload(attachments) : undefined,
  };
  const hasContent =
    to.trim().length > 0 || cc.trim().length > 0 || bcc.trim().length > 0 || subject.trim().length > 0 || bodyText.trim().length > 0;
  useEffect(() => {
    const serialized = JSON.stringify(draftPayload);
    if (!hasContent || serialized === lastSaved.current || saveDraft.isPending) return;
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

  const toList = parseEmailList(to);
  const ccList = parseEmailList(cc);
  const bccList = parseEmailList(bcc);
  const canSend = toList.length > 0 && subject.trim().length > 0 && bodyText.trim().length > 0;

  // Hide anything already entered in any recipient field from every
  // field's suggestions.
  const allRecipients = [...toList, ...ccList, ...bccList];

  function send() {
    compose.mutate(
      {
        to: toList,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        subject,
        bodyText,
        bodyHtml,
        attachments: attachments.length > 0 ? attachmentsToPayload(attachments) : undefined,
      },
      {
        onSuccess: () => {
          // A sent draft is no longer a draft. Fire-and-forget: navigation
          // shouldn't wait on (or fail because of) the cleanup call.
          if (draftId !== undefined) deleteDraft.mutate(draftId);
          navigate('/');
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-2 pb-10 sm:px-6">
      <NavBar />
      <h1 className="mb-8 mt-6 text-center text-4xl font-bold">Write</h1>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <RecipientField value={to} onChange={setTo} placeholder="To" exclude={allRecipients} />
        <RecipientField value={cc} onChange={setCc} placeholder="Cc (optional)" exclude={allRecipients} />
        <RecipientField value={bcc} onChange={setBcc} placeholder="Bcc (optional)" exclude={allRecipients} />
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className={fieldClass}
        />
        <RichTextEditor
          key={prefilledFor.current ?? 'blank'}
          initialHtml={prefilledFor.current !== null ? bodyHtml : undefined}
          placeholder="Write your message..."
          onUpdate={(html, text) => {
            setBodyHtml(html);
            setBodyText(text);
          }}
        />
        <AttachmentPicker attachments={attachments} onChange={setAttachments} />
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-sm text-muted-foreground hover:underline">
            Cancel
          </button>
          <span className="text-xs text-muted-foreground">{savingDraft ? 'Saving draft…' : draftId !== undefined ? 'Draft saved' : ''}</span>
          <button
            type="button"
            disabled={compose.isPending || !canSend}
            onClick={send}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {compose.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {compose.isError && <p className="text-sm text-red-400">{compose.error.message}</p>}
      </div>
    </div>
  );
}

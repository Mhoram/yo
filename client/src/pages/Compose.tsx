import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { RichTextEditor } from '../components/RichTextEditor';
import { AttachmentPicker, attachmentsToPayload, type PendingAttachment } from '../components/AttachmentPicker';
import { RecipientField } from '../components/RecipientField';
import { useComposeMessage } from '../hooks/useCompose';

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
  const navigate = useNavigate();
  const compose = useComposeMessage();

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
      { onSuccess: () => navigate('/') },
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

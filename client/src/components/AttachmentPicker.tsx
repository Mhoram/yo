import { useEffect, useId, useRef, useState } from 'react';

export interface PendingAttachment {
  file: File;
  contentBase64: string;
}

const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // Gmail's own cap

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function attachmentsToPayload(attachments: PendingAttachment[]) {
  return attachments.map((a) => ({
    filename: a.file.name,
    contentBase64: a.contentBase64,
    contentType: a.file.type || undefined,
  }));
}

// Inverse of attachmentsToPayload, for restoring a saved draft: rebuilds
// real File objects from the stored payload so the picker and the send path
// treat restored and freshly-picked files identically.
export function payloadToPendingAttachments(
  payload: { filename: string; contentBase64: string; contentType?: string }[],
): PendingAttachment[] {
  return payload.map((a) => {
    const bytes = Uint8Array.from(atob(a.contentBase64), (c) => c.charCodeAt(0));
    const file = new File([bytes], a.filename, { type: a.contentType ?? 'application/octet-stream' });
    return { file, contentBase64: a.contentBase64 };
  });
}

interface AttachmentPickerProps {
  attachments: PendingAttachment[];
  onChange: (attachments: PendingAttachment[]) => void;
}

export function AttachmentPicker({ attachments, onChange }: AttachmentPickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrls, setPreviewUrls] = useState<Map<File, string>>(new Map());
  const totalBytes = attachments.reduce((sum, a) => sum + a.file.size, 0);

  // Local, instant image previews before sending: object URLs, not a
  // network round-trip. Kept in sync with the current attachment list and
  // revoked as files are removed (or the component unmounts) to avoid
  // leaking them.
  useEffect(() => {
    setPreviewUrls((prev) => {
      const next = new Map<File, string>();
      for (const a of attachments) {
        if (a.file.type.startsWith('image/')) {
          next.set(a.file, prev.get(a.file) ?? URL.createObjectURL(a.file));
        }
      }
      for (const [file, url] of prev) {
        if (!next.has(file)) URL.revokeObjectURL(url);
      }
      return next;
    });
  }, [attachments]);

  useEffect(
    () => () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    // Only run on unmount; previewUrls itself is intentionally excluded,
    // the effect above already keeps it in sync as attachments change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files);
    const newTotal = totalBytes + newFiles.reduce((sum, f) => sum + f.size, 0);
    if (newTotal > MAX_TOTAL_BYTES) {
      alert(`That would total ${(newTotal / 1024 / 1024).toFixed(1)}MB of attachments. Gmail's limit is 25MB.`);
      return;
    }
    const withContent = await Promise.all(
      newFiles.map(async (file) => ({ file, contentBase64: await readFileAsBase64(file) })),
    );
    onChange([...attachments, ...withContent]);
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(index: number) {
    onChange(attachments.filter((_, i) => i !== index));
  }

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
      <label
        htmlFor={inputId}
        className="inline-block cursor-pointer rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted"
      >
        Attach files
      </label>
      {attachments.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => {
            const previewUrl = previewUrls.get(a.file);
            return (
              <li
                key={`${a.file.name}-${i}`}
                className={
                  previewUrl
                    ? 'w-28 overflow-hidden rounded-md border border-border'
                    : 'flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm'
                }
              >
                {previewUrl ? (
                  <>
                    <img src={previewUrl} alt={a.file.name} className="h-28 w-28 object-cover" />
                    <div className="flex items-center justify-between gap-1 bg-card px-2 py-1">
                      <span className="truncate text-xs text-muted-foreground">{a.file.name}</span>
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className="shrink-0 text-xs text-muted-foreground hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="truncate text-foreground">
                      {a.file.name} <span className="text-muted-foreground">({Math.ceil(a.file.size / 1024)} KB)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="shrink-0 text-muted-foreground hover:text-red-400"
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

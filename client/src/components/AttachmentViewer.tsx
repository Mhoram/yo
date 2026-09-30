import { useEffect } from 'react';

export interface ViewingAttachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

// Modal attachment viewer. PDFs/Audio/video/plain text render inline via
// the server's inline delivery (MIME-allowlisted server-side, nosniff on);
// anything else shows a download-only panel. Images render directly —
// they're same-origin `<img>`s, which can't execute.
export function AttachmentViewer({ attachment, onClose }: { attachment: ViewingAttachment; onClose: () => void }) {
  const { url, filename, mimeType, size } = attachment;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const inlineUrl = `${url}?inline=1`;
  const isPdf = mimeType === 'application/pdf';
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');
  const isText = mimeType === 'text/plain';

  return (
    // Backdrop click closes; the panel stops propagation so clicking inside
    // (scrolling a PDF, playing audio) doesn't dismiss it.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-6" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{filename}</p>
            <p className="text-xs text-muted-foreground">{Math.max(1, Math.ceil(size / 1024))} KB</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={url}
              className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted"
            >
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close viewer"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 bg-muted/40">
          {isPdf && <iframe src={inlineUrl} title={filename} className="h-full w-full border-0" />}
          {isImage && (
            <div className="flex h-full w-full items-center justify-center p-4">
              <img src={inlineUrl} alt={filename} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {isVideo && <video src={inlineUrl} controls className="h-full w-full" />}
          {isAudio && (
            <div className="flex h-full w-full items-center justify-center p-6">
              <audio src={inlineUrl} controls className="w-full max-w-md" />
            </div>
          )}
          {isText && <iframe src={inlineUrl} title={filename} className="h-full w-full border-0 bg-white" />}
          {!isPdf && !isImage && !isVideo && !isAudio && !isText && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-sm text-muted-foreground">No preview available for this file type.</p>
              <a href={url} className="text-sm font-semibold text-primary hover:underline">
                Download {filename}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

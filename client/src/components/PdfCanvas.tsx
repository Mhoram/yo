import { useEffect, useRef, useState } from 'react';

// Renders a PDF in the app itself via pdf.js (Mozilla's renderer), drawing
// each page to a canvas. Browser-native <iframe src="x.pdf"> embedding is
// NOT portable — iOS Safari and Android WebViews won't render PDFs in
// iframes (blank frame at best, a download at worst) — and pdf.js works
// everywhere the PWA does, including phones.
//
// pdf.js is loaded lazily (dynamic import) so its ~400 KB never touches
// the main bundle; it only loads when someone actually opens a PDF.

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | undefined;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    },
  );
  return pdfjsPromise;
}

export function PdfCanvas({ url }: { url: string }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        // Fetch with credentials ourselves rather than handing pdf.js the
        // URL — same-origin fetch carries the session cookie explicitly.
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
        const pdf = await pdfjs.getDocument({ data: await res.arrayBuffer() }).promise;

        const container = pagesRef.current;
        if (!container || cancelled) return;
        container.replaceChildren();

        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) return;
          const page = await pdf.getPage(n);
          // 1.5 ≈ comfortable reading resolution on both desktop and phone.
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          canvas.style.maxWidth = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 8px';
          container.appendChild(canvas);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-muted-foreground">Couldn't render this PDF.</p>
        <a href={url} className="text-sm font-semibold text-primary hover:underline">
          Download it instead
        </a>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto p-3">
      <div ref={pagesRef} />
    </div>
  );
}

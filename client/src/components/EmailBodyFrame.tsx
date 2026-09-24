import { useCallback, useEffect, useRef, useState } from 'react';

// Renders untrusted email HTML in a sandboxed iframe so its own styles/markup
// can never collide with the app's. This is the actual fix for white-on-white text,
// tiny fonts, and broken spacing that happen when third-party email HTML is
// injected straight into our own DOM. No allow-scripts, so nothing in the
// email body can ever execute. allow-same-origin alone is safe here (the
// classic sandbox-escape needs both together) and is what lets us read the
// frame's content back out to measure its real height.
export function EmailBodyFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const measure = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc?.documentElement) {
      setHeight(doc.documentElement.scrollHeight);
    }
  }, []);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.documentElement) return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(doc.documentElement);
    return () => observer.disconnect();
  }, [html, measure]);

  const srcDoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<base target="_blank" />
<style>
  html, body { margin: 0; padding: 16px; background: #ffffff; color: #1a1a1a; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Arial, sans-serif; font-size: 15px; line-height: 1.5; word-wrap: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #3366cc; }
  /* Mail we compose ourselves wraps each list item's text in its own <p>
     (TipTap's doing). Without this, the paragraph's default browser margin
     stacks on top of the list item's own spacing and lists look
     double-spaced. */
  li > p { margin: 0; }
  li { margin: 0.2em 0; }
</style>
</head>
<body>${html}</body>
</html>`;

  return (
    <iframe
      ref={iframeRef}
      title="Email body"
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height, border: 'none', display: 'block' }}
      onLoad={measure}
    />
  );
}

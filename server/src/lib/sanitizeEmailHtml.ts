import sanitizeHtml from 'sanitize-html';

// Email bodies are rendered client-side inside a sandboxed <iframe> (see
// EmailBodyFrame.tsx), fully isolated from the app's own CSS/DOM, so unlike
// sanitizing HTML for direct injection into our own page, we don't need to
// restrict which CSS properties/values are used (that's what made colors
// defined via <style> blocks or non-allowlisted properties silently vanish,
// producing things like white-on-white text). We still strip script-capable
// tags/attributes; sandboxing the iframe (no allow-scripts) is the real
// security boundary against anything that slips through.
const emailSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img',
    'span',
    'font',
    'u',
    'center',
    'sup',
    'sub',
    'small',
    'style',
  ]),
  // sanitize-html warns that allowing <style> is "inherently vulnerable to
  // XSS", which is true advice for HTML dropped into a live page, but the classic
  // <style>-based vectors (expression(), -moz-binding, @import fetching a
  // script masquerading as CSS) are all about getting script to execute,
  // and nothing here can execute: the iframe has no allow-scripts. Silencing
  // the warning on purpose, not by oversight.
  allowVulnerableTags: true,
  allowedAttributes: {
    '*': ['style', 'class', 'align', 'valign', 'width', 'height', 'border', 'bgcolor', 'color', 'id'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    table: ['cellpadding', 'cellspacing', 'border', 'width', 'align'],
    font: ['color', 'face', 'size'],
  },
  // 'data:' is scoped to <img> only via allowedSchemesByTag below; it must
  // NOT be in this global list, or a <a href="data:..."> link (which gets
  // target="_blank" below) opens a real, unsandboxed new tab.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, emailSanitizeOptions);
}

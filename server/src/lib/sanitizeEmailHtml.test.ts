import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from './sanitizeEmailHtml.js';

describe('sanitizeEmailHtml', () => {
  it('keeps images and their src/style: the whole reason the custom allowlist exists', () => {
    const out = sanitizeEmailHtml('<img src="https://example.com/pic.png" style="max-width:100%" alt="pic">');
    expect(out).toContain('<img');
    expect(out).toContain('src="https://example.com/pic.png"');
  });

  it('keeps data: URI images (inline cid-resolved attachments)', () => {
    const out = sanitizeEmailHtml('<img src="data:image/png;base64,AAAA">');
    expect(out).toContain('data:image/png;base64,AAAA');
  });

  it('keeps inline style attributes and color/font declarations', () => {
    const out = sanitizeEmailHtml('<p style="color:#ff0000;font-size:20px">hi</p>');
    expect(out).toContain('style="color:#ff0000;font-size:20px"');
  });

  it('strips script tags entirely', () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
  });

  it('strips inline event handler attributes', () => {
    const out = sanitizeEmailHtml('<img src="x.png" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
  });

  it('forces external links to open in a new tab with noopener/noreferrer', () => {
    const out = sanitizeEmailHtml('<a href="https://example.com">link</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('rejects a javascript: URL scheme on links', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('rejects a data: URL on a link; that would open unsandboxed in a real new tab', () => {
    const out = sanitizeEmailHtml('<a href="data:text/html;base64,AAAA">click</a>');
    expect(out).not.toContain('data:text/html');
  });

  it('still allows data: URIs on images specifically (cid-resolved inline images need this)', () => {
    const out = sanitizeEmailHtml('<img src="data:image/png;base64,AAAA">');
    expect(out).toContain('data:image/png;base64,AAAA');
  });

  it('keeps <style> blocks (safe here only because the iframe has no allow-scripts)', () => {
    const out = sanitizeEmailHtml('<style>.brand { color: #ff0000; }</style><p class="brand">hi</p>');
    expect(out).toContain('<style>');
    expect(out).toContain('.brand');
  });
});

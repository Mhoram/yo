import type { OutgoingAttachment } from '../mail-provider/types.js';

// Gmail's own cap on total message size (including attachments).
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export function parseAttachments(raw: unknown): { attachments?: OutgoingAttachment[]; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (!Array.isArray(raw)) return { error: 'attachments must be an array' };

  let totalBytes = 0;
  const attachments: OutgoingAttachment[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== 'object' || item === null) {
      return { error: `attachments[${i}] must be an object` };
    }
    const { filename, contentBase64, contentType } = item as Record<string, unknown>;
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      return { error: `attachments[${i}].filename is required` };
    }
    if (typeof contentBase64 !== 'string' || contentBase64.length === 0) {
      return { error: `attachments[${i}].contentBase64 is required` };
    }
    if (contentType !== undefined && typeof contentType !== 'string') {
      return { error: `attachments[${i}].contentType must be a string` };
    }

    // base64 decodes to ~3/4 of its encoded length.
    totalBytes += Math.ceil((contentBase64.length * 3) / 4);
    attachments.push({ filename, contentBase64, contentType });
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    return { error: `Attachments total ${Math.round(totalBytes / 1024 / 1024)}MB, over Gmail's 25MB limit` };
  }

  return { attachments };
}

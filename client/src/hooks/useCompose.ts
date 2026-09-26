import { useMutation } from '@tanstack/react-query';
import { api, type OutgoingAttachment } from '../lib/api';

export function useComposeMessage() {
  return useMutation({
    mutationFn: (opts: {
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      bodyText: string;
      bodyHtml?: string;
      attachments?: OutgoingAttachment[];
    }) => api.composeMessage(opts),
  });
}

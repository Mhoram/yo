import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

// BIMI logos are keyed by domain, not by any per-message data, so they
// almost never change, so a long staleTime avoids re-hitting the server (and
// its DNS lookup) every time an avatar remounts.
export function useSenderLogo(email: string | undefined) {
  const normalized = email?.trim().toLowerCase() || undefined;
  return useQuery({
    queryKey: ['senderLogo', normalized],
    queryFn: () => api.getSenderLogo(normalized!),
    enabled: Boolean(normalized),
    staleTime: 24 * 60 * 60_000,
  });
}

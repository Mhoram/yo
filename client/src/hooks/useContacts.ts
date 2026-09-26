import { useQuery } from '@tanstack/react-query';
import { api, type KnownContact } from '../lib/api';

// Known contacts for compose autocomplete (sent-mail recipients + approved
// senders, from the server's local cache). Fetched once and cached for the
// session; typing filters this list client-side, so suggesting costs zero
// Gmail quota and zero network round-trips per keystroke.
export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: api.listContacts,
    staleTime: 5 * 60 * 1000,
    select: (data: { contacts: KnownContact[] }) => data.contacts,
  });
}

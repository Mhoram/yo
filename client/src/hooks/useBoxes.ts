import { useQuery } from '@tanstack/react-query';
import { api, type MailBox } from '../lib/api';

// Unread counts for the box switcher, straight from Gmail's label counters
// (one cheap labels.list call server-side). Cached briefly; refetches when
// a mutation invalidates ['boxes'] (e.g. approving a sender, trashing).
export function useBoxes() {
  return useQuery({
    queryKey: ['boxes'],
    queryFn: api.listBoxes,
    staleTime: 30 * 1000,
    select: (data: { boxes: MailBox[] }) => data.boxes,
  });
}

export function unreadFor(boxes: MailBox[] | undefined, key: MailBox['key']): number | undefined {
  return boxes?.find((b) => b.key === key)?.unread;
}

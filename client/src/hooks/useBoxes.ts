import { useQuery } from '@tanstack/react-query';
import { api, type MailBox } from '../lib/api';

// Unread badges for the box switcher: unread threads from the last 7 days
// per box, counted server-side (the raw Gmail label counters would report
// the whole unread backlog, and a page-size cap saturates at "15+" on a
// busy mailbox). Cached briefly; refetches when a mutation invalidates
// ['boxes'] (e.g. approving a sender, trashing).
export function useBoxes() {
  return useQuery({
    queryKey: ['boxes'],
    queryFn: api.listBoxes,
    staleTime: 30 * 1000,
    select: (data: { boxes: MailBox[] }) => data.boxes,
  });
}

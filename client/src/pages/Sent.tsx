import { ThreadList } from '../components/ThreadList';

export function Sent() {
  return <ThreadList label="SENT" title="Sent" emptyMessage="No sent mail yet." perspective="sent" />;
}

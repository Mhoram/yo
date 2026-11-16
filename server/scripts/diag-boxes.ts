import { env } from '../src/env.js';
import { GmailProvider } from '../src/mail-provider/GmailProvider.js';
import { BUCKET_LABELS } from '../src/gatekeeper/gatekeeperService.js';
import { ensureLabel } from '../src/mail-provider/labelRegistry.js';

// Same code path as GET /api/boxes now uses.
const BADGE_WINDOW_DAYS = 7;
const BADGE_CAP = 99;

async function main() {
  const provider = new GmailProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  const t0 = Date.now();
  const [receiptsId, feedId] = await Promise.all([
    ensureLabel(provider, BUCKET_LABELS.receipts),
    ensureLabel(provider, BUCKET_LABELS.feed),
  ]);
  const recentUnread = async (labelId: string) => {
    const { threadIds } = await provider.listThreadIds({
      label: labelId,
      q: `is:unread newer_than:${BADGE_WINDOW_DAYS}d`,
      maxResults: BADGE_CAP + 1,
    });
    return { unread: Math.min(threadIds.length, BADGE_CAP), unreadCapped: threadIds.length > BADGE_CAP };
  };
  const [yobox, receipts, feed] = await Promise.all([
    recentUnread('INBOX'),
    recentUnread(receiptsId),
    recentUnread(feedId),
  ]);
  console.log(JSON.stringify({ boxes: [
    { key: 'yobox', ...yobox },
    { key: 'receipts', ...receipts },
    { key: 'feed', ...feed },
  ] }), `in ${Date.now() - t0}ms`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

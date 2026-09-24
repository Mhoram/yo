// One-time backfill: pending senders created before first_thread_id existed
// have no thread to link to from the Gatekeeper UI. Look one up per sender via
// Gmail search (cheap: list-only, no body fetch) and fill it in.
import 'dotenv/config';
import { GmailProvider } from '../src/mail-provider/GmailProvider.js';
import { listPendingSenders, setThreadIdIfMissing } from '../src/db/senderApprovals.js';
import { GATEKEEPER_PENDING_LABEL } from '../src/gatekeeper/gatekeeperService.js';

const provider = new GmailProvider(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!,
  process.env.GOOGLE_REDIRECT_URI!,
);

async function main() {
  const missing = listPendingSenders().filter((s) => !s.first_thread_id);
  console.log(`${missing.length} pending senders missing a thread id.`);

  let filled = 0;
  for (const sender of missing) {
    const { threadIds } = await provider.listThreadIds({
      q: `from:${sender.sender_email} label:${GATEKEEPER_PENDING_LABEL}`,
      maxResults: 1,
    });
    if (threadIds[0]) {
      setThreadIdIfMissing(sender.sender_email, threadIds[0]);
      filled++;
    }
  }
  console.log(`Filled ${filled}/${missing.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

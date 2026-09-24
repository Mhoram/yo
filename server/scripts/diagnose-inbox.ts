// Read-only diagnostic: how many of the current top Gmail INBOX threads
// would resolve to each Gatekeeper status, without performing any label
// changes. Helps distinguish "just need to page deeper" from "gating logic
// is actually broken."
import 'dotenv/config';
import { GmailProvider } from '../src/mail-provider/GmailProvider.js';
import { getSenderApproval } from '../src/db/senderApprovals.js';

const clientId = process.env.GOOGLE_CLIENT_ID!;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

const provider = new GmailProvider(clientId, clientSecret, redirectUri);

const SAMPLE_SIZE = Number(process.argv[2] ?? 50);

async function main() {
  const { threadIds } = await provider.listThreadIds({ label: 'INBOX', maxResults: SAMPLE_SIZE });
  console.log(`Sampling ${threadIds.length} threads currently in Gmail's INBOX label.`);

  const tally: Record<string, number> = {
    pending: 0,
    approved_yobox: 0,
    approved_other_bucket: 0,
    blocked: 0,
    not_in_db: 0,
  };
  const examples: { email: string; status: string; bucket: string | null }[] = [];

  for (const id of threadIds) {
    const thread = await provider.getThread(id, { full: false });
    const last = thread.messages.at(-1);
    if (!last) continue;
    const email = last.from.email.toLowerCase();
    const approval = getSenderApproval(email);

    if (!approval) {
      tally.not_in_db++;
      examples.push({ email, status: 'not_in_db', bucket: null });
    } else if (approval.status === 'pending') {
      tally.pending++;
    } else if (approval.status === 'blocked') {
      tally.blocked++;
    } else if (approval.bucket === null || approval.bucket === 'yobox') {
      tally.approved_yobox++;
      examples.push({ email, status: 'approved_yobox', bucket: approval.bucket });
    } else {
      tally.approved_other_bucket++;
    }
  }

  console.log('Tally:', tally);
  console.log('Examples (not_in_db / approved_yobox: these SHOULD show in Yobox+Gatekeeper):');
  console.log(examples.slice(0, 15));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

# yo

A personal email client that sits on top of your existing Gmail account. New senders go to the Gatekeeper and wait there until you approve or block them. Mail from approved senders gets sorted into Yobox, Receipts, or Feed instead of piling up in one flat inbox. It talks to Gmail through the Gmail API, so your mail stays in Gmail the whole time.

## License

[AGPL-3.0](./LICENSE). Free to self-host, forever. If you modify it and offer it as a hosted service, the license requires you to release your modified source. The copyright holder may additionally license it under commercial terms on request.

## Status

What works today:

- Google OAuth login, thread list and reader
- The Gatekeeper: mail from unknown senders is held until you approve or block them
- Picking a bucket (Yobox, Receipts, or Feed) when you approve a sender
- Receipts and Feed views with infinite scroll
- Compose, reply, forward, attachments
- Recipient autocomplete in To/Cc/Bcc, built from your own sent mail and approved senders (local cache, no quota cost while typing)
- Search
- Sent view, built on Gmail's `SENT` label but shown from the recipient's point of view
- "Move to..." to change an approved sender's bucket from a thread view
- Sender logos via BIMI (the DNS-based brand logo system Gmail and Yahoo already use), with initials as fallback
- PWA install (manifest, icons, service worker). No offline support yet.
- Mobile layout: a popup box switcher that sits at the bottom of the screen on phones, condensed thread rows, a nav bar notice when senders are waiting on a Gatekeeper decision
- Migration script if you're coming from HEY and want to keep your sender history (see [Scripts](#one-off-scripts))
- Gmail API quota tracking and logging (see [Debugging](#debugging--telemetry))
- Self-hosting via Docker, see [`deploy/self-host.md`](./deploy/self-host.md)
- Nightly database backup to S3 or any rclone remote, see `deploy/backup-db.sh` and [`deploy/self-host.md`](./deploy/self-host.md) §8
- Automatic Gemini code review on pull requests

Not done yet (see [`ROADMAP.md`](./ROADMAP.md)): push notifications, bucket suggestions when approving a sender, light mode.

## Quick start

### 1. Install dependencies

```bash
npm install
```

This is an npm workspaces monorepo (`client/`, `server/`), so one install at the root covers both.

### 2. Set up Google OAuth credentials

You need a Google Cloud project with a Gmail API OAuth client:

1. [Google Cloud Console](https://console.cloud.google.com/), create or select a project
2. APIs & Services → Library → enable the **Gmail API**
3. APIs & Services → OAuth consent screen:
   - User type: External
   - Scopes: `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/gmail.send`
   - Test users: add your own Gmail address
   - Leave Publishing status as **Testing**. No verification needed for personal use.
4. APIs & Services → Credentials → Create Credentials → OAuth client ID:
   - Application type: Web application
   - Authorized redirect URI: `http://localhost:3001/auth/callback`
5. Copy the Client ID and Client Secret into `.env` (next step)

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a random `SESSION_SECRET`. The other defaults are fine for local dev.

### 4. Run it

```bash
npm run dev
```

This starts the server on `http://localhost:3001` and the client on `http://localhost:5173` via `concurrently`. Vite proxies `/api` and `/auth` to the server, so the app is same-origin in dev. Open `http://localhost:5173` and sign in.

One thing to know: while the OAuth consent screen is in "Testing" status, Google may expire refresh tokens after about 7 days of inactivity. If you get logged out unexpectedly, just sign in again. No data is lost; gatekeeper and bucket decisions live in the local SQLite database, not in the OAuth session.

## How it works

**server/** is Express + TypeScript. All Gmail-specific code sits behind the `MailProvider` interface (`server/src/mail-provider/MailProvider.ts`), implemented by `GmailProvider.ts`. Nothing else imports `googleapis`, so swapping the backend later wouldn't touch the routes or the gatekeeper logic.

**client/** is Vite + React + TypeScript + Tailwind v4, with React Query for data fetching (`useInfiniteQuery` for the scrollable lists) and React Router for navigation.

**server/data/yo.db** is SQLite (via `better-sqlite3`). It stores gatekeeper decisions, OAuth tokens, and a sync cursor. It never stores your mail; Gmail stays the source of truth and message content is fetched live.

**The gatekeeper mechanism** is just Gmail labels: `App/Gatekeeper-Pending`, `App/Gatekeeper-Blocked`, `App/Receipts`, and `App/Feed`, plus Gmail's own `INBOX` and `UNREAD`. See `server/src/gatekeeper/gatekeeperService.ts`. A nice side effect is that your sorting stays visible if you ever open Gmail's own UI.

**Email bodies** render in a sandboxed `<iframe>` (`client/src/components/EmailBodyFrame.tsx`, no `allow-scripts`) instead of being injected into the app's DOM. This is what keeps third-party email HTML and CSS from colliding with the app's styling, i.e. the white-text-on-white-background problem. It's the same approach most email clients use.

**Sender logos** come from a DNS lookup against BIMI records (`server/src/lib/bimiLookup.ts`, cached in memory) and render through a plain `<img>` in `client/src/components/Avatar.tsx`. The SVG is never inlined, since that would defeat the browser's script sandboxing for images. When there's no BIMI record, you get initials instead.

### Key files

| File | Purpose |
|---|---|
| `server/src/mail-provider/MailProvider.ts` | The provider-neutral interface everything else depends on |
| `server/src/mail-provider/GmailProvider.ts` | The only file that imports `googleapis` |
| `server/src/gatekeeper/gatekeeperService.ts` | Gatekeeping, approve/block, bucket routing |
| `server/src/routes/threads.ts` | List/read endpoints, gatekeeper gating, quota-aware pagination |
| `server/src/lib/quotaTracker.ts` | Gmail API quota tracking (see below) |
| `server/src/lib/bimiLookup.ts` | BIMI DNS lookup for sender logos |
| `server/src/db/database.ts` | SQLite connection, test/dev DB isolation (see Known quirks) |
| `client/src/components/ThreadList.tsx` | Shared infinite-scroll list used by Yobox/Receipts/Feed/Sent |
| `client/src/components/EmailBodyFrame.tsx` | Sandboxed iframe email body renderer |
| `client/src/components/NavBar.tsx` / `BoxMenuButton.tsx` | Top nav and the popup box switcher |
| `client/src/components/Avatar.tsx` | Sender avatar: BIMI logo or initials |

## Quota tracking

Gmail's API quota (6,000 units/minute/user) is tight enough to hit in normal use, especially after a bulk operation like an import or a mass approval. Every Gmail API call is logged:

- Server console: `[quota] <method> (+N units), rolling 60s: <total> units across <count> calls`
- `GET /api/debug/quota` (while logged in) returns a live JSON snapshot of the current 60-second window, broken down by method, plus the last 30 calls

If you hit a quota error, wait about 60 seconds before retrying. The client has retries disabled on purpose: retrying a quota error just burns more quota.

## One-off scripts

Run from `server/` with `npx tsx scripts/<name>`. These were written for specific one-time tasks during development; they're not part of the running app.

- `import-hey-history.ts <denied.json> <receipts.json> <feed.json>`: coming from HEY? This seeds `sender_approvals` from your HEY gatekeeper/box history (fetched via the `hey` CLI). It only fills in rows that are still `pending` in this app, so it never overwrites a decision you already made here.
- `migrate-gmail-labels.mjs`: moves threads off the pre-rename labels (`App/Screener-*`, `App/Paper-Trail`) onto the current ones (`App/Gatekeeper-*`, `App/Receipts`), then deletes the old labels. Only needed if you ran an older build. Safe to re-run.
- `backfill-pending-thread-ids.ts`: finds one held thread per pending sender for rows created before thread-linking existed in the Gatekeeper UI.
- `diagnose-inbox.ts [sampleSize]`: read-only diagnostic. Samples the top N Gmail INBOX threads and tallies how each sender would resolve (pending / approved-yobox / other bucket / blocked / not in DB) without changing any labels. Useful for "why is Yobox empty" questions.

## Known quirks

**Invalidating an infinite-scroll query re-fetches the whole page chain.** React Query's `invalidateQueries` with `queryKey: ['threads']` prefix-matches Yobox, Receipts, and Feed at once, and re-fetches every accumulated page, not just page one. `ThreadView` patches the cache directly with `setQueriesData` instead, so opening one email doesn't silently re-fetch a big chunk of Gmail data. Keep this in mind before adding new `invalidateQueries(['threads'])` calls.

**Stale cache after hot reload.** If you change a query's shape (say, `useQuery` to `useInfiniteQuery`) while the dev server is running, Vite's HMR can leave the old cached shape in React Query's memory and crash confusingly. A hard refresh clears it. Not a real bug.

**First load after a bulk sender decision can be slow.** Every thread whose Gmail labels need to change costs one `threads.modify` call the first time it's encountered. That's a one-time cost per thread, not per page load.

**"New for you" only looks at the first page of results.** It is not recomputed from pages accumulated via infinite scroll (see `ThreadList.tsx`). If your Gmail account has a big backlog of genuinely unread mail, deriving that section from all loaded pages means every scroll keeps dumping old threads into it, which sits above "Previously seen" and shifts content while you read. If you're tempted to "fix" this by deriving from the full accumulated list: don't.

**Tests must never touch the real `server/data/yo.db`.** `database.ts` defaults to `:memory:` whenever `process.env.VITEST` is set (vitest sets it itself) and `DB_PATH` isn't overridden. This exists because a bare `npx vitest run` once wrote fake rows into the real dev database. Run tests through `npm test` / `npm run test:watch`, and don't rely on the fallback alone.

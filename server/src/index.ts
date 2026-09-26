import express from 'express';
import cors from 'cors';
import cookieSession from 'cookie-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import './db/database.js';
import { GmailProvider } from './mail-provider/GmailProvider.js';
import { authRouter } from './routes/auth.js';
import { threadsRouter } from './routes/threads.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { sendersRouter } from './routes/senders.js';
import { composeRouter } from './routes/compose.js';
import { attachmentsRouter } from './routes/attachments.js';
import { searchRouter } from './routes/search.js';
import { contactsRouter } from './routes/contacts.js';
import { getQuotaSnapshot } from './lib/quotaTracker.js';

const mailProvider = new GmailProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);

const app = express();

app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
// Attachments travel as base64 inside the JSON body (simpler than a
// multipart upload endpoint); base64 inflates size by ~1/3, so this needs
// real headroom above Gmail's 25MB attachment cap.
app.use(express.json({ limit: '35mb' }));
app.use(
  cookieSession({
    name: 'yo-session',
    secret: env.SESSION_SECRET,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
  }),
);

app.use('/auth', authRouter(mailProvider));

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
}

app.use('/api/threads', requireAuth, threadsRouter(mailProvider));
app.use('/api/gatekeeper', requireAuth, gatekeeperRouter(mailProvider));
app.use('/api/senders', requireAuth, sendersRouter(mailProvider));
app.use('/api/compose', requireAuth, composeRouter(mailProvider));
app.use('/api/attachments', requireAuth, attachmentsRouter(mailProvider));
app.use('/api/search', requireAuth, searchRouter(mailProvider));
app.use('/api/contacts', requireAuth, contactsRouter(mailProvider));
app.get('/api/debug/quota', requireAuth, (_req, res) => res.json(getQuotaSnapshot()));

// Self-hosted deploys run a single container, so this
// process also serves the already-built client instead of a separate static
// host. Dev keeps using Vite's own dev server (`npm run dev`), which proxies
// /api and /auth here instead, so this block only matters in production.
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/auth).*$/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(env.PORT, () => {
  console.log(`yo server listening on http://localhost:${env.PORT}`);
});

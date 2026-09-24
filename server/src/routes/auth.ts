import { Router } from 'express';
import type { MailProvider } from '../mail-provider/MailProvider.js';
import { env } from '../env.js';

export function authRouter(mailProvider: MailProvider): Router {
  const router = Router();

  router.get('/google', (_req, res) => {
    res.redirect(mailProvider.getAuthUrl());
  });

  router.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (typeof code !== 'string') {
      res.status(400).send('Missing OAuth code');
      return;
    }
    try {
      await mailProvider.handleAuthCallback(code);
      req.session!.authenticated = true;
      res.redirect(env.CLIENT_ORIGIN);
    } catch (err) {
      console.error('OAuth callback failed', err);
      res.status(500).send((err as Error).message);
    }
  });

  router.post('/logout', (req, res) => {
    req.session = null;
    res.status(204).end();
  });

  router.get('/status', async (req, res) => {
    const hasSession = Boolean(req.session?.authenticated);
    const hasTokens = await mailProvider.isAuthenticated();
    res.json({ authenticated: hasSession && hasTokens });
  });

  return router;
}

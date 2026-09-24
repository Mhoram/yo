import { db } from './database.js';

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scope?: string;
  token_type?: string;
}

export function saveTokens(tokens: StoredTokens): void {
  db.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, expiry_date, scope, token_type)
     VALUES (1, @access_token, @refresh_token, @expiry_date, @scope, @token_type)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
       expiry_date = excluded.expiry_date,
       scope = excluded.scope,
       token_type = excluded.token_type`,
  ).run({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    scope: tokens.scope ?? null,
    token_type: tokens.token_type ?? null,
  });
}

export function loadTokens(): StoredTokens | undefined {
  return db.prepare('SELECT * FROM oauth_tokens WHERE id = 1').get() as StoredTokens | undefined;
}

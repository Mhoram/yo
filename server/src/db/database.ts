import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// vitest sets process.env.VITEST. Default to an isolated in-memory DB under
// test even if DB_PATH wasn't explicitly passed (e.g. `npx vitest run`
// instead of `npm test`), so a test run can never write fixtures into the
// real dev database again like it once did.
const DB_PATH = process.env.DB_PATH || (process.env.VITEST ? ':memory:' : path.join(__dirname, '..', '..', 'data', 'yo.db'));

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

import { migrations } from './migrations.js';
for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch {
    // column/table already exists; migrations are append-only and safe to re-run
  }
}

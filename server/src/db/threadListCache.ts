import { db } from './database.js';
import type { ThreadSummaryDto } from '../lib/threadSummary.js';

export interface CachedThreadListPage {
  historyId: string;
  nextPageToken?: string;
  summaries: ThreadSummaryDto[];
}

// First-page thread-list cache backing GET /api/threads. Gmail quota makes
// re-fetching a page of thread metadata expensive (~600 units for 15
// threads) and slow (~1s), while a validity check is one cheap getProfile
// call. Only the first page per label is cached — infinite-scroll pages are
// rare, still live-fetched, and keyed off opaque page tokens we don't track.
export function readThreadListPage(label: string): CachedThreadListPage | undefined {
  const row = db
    .prepare('SELECT history_id, next_page_token, summaries_json FROM thread_list_pages WHERE label = ?')
    .get(label) as { history_id: string; next_page_token: string | null; summaries_json: string } | undefined;
  if (!row) return undefined;
  return {
    historyId: row.history_id,
    nextPageToken: row.next_page_token ?? undefined,
    summaries: JSON.parse(row.summaries_json) as ThreadSummaryDto[],
  };
}

// historyId must be captured BEFORE the live fetch that produced these
// summaries: a change landing mid-fetch then just means the next load
// misses the cache and goes live again, never that it serves stale data.
export function writeThreadListPage(
  label: string,
  historyId: string,
  nextPageToken: string | undefined,
  summaries: ThreadSummaryDto[],
): void {
  db.prepare(
    `INSERT INTO thread_list_pages (label, history_id, next_page_token, summaries_json, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(label) DO UPDATE SET
       history_id = excluded.history_id,
       next_page_token = excluded.next_page_token,
       summaries_json = excluded.summaries_json,
       fetched_at = excluded.fetched_at`,
  ).run(label, historyId, nextPageToken ?? null, JSON.stringify(summaries), new Date().toISOString());
}

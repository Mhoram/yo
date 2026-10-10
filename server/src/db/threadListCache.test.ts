import { describe, expect, it } from 'vitest';
import { readThreadListPage, writeThreadListPage } from './threadListCache.js';
import type { ThreadSummaryDto } from '../lib/threadSummary.js';

function summary(id: string): ThreadSummaryDto {
  return { id, snippet: 'hi', labelIds: ['INBOX'], subject: 's', unread: true, messageCount: 1 };
}

describe('threadListCache', () => {
  it('round-trips a written page', () => {
    writeThreadListPage('INBOX', '100', 'tok-next', [summary('t1'), summary('t2')]);

    const cached = readThreadListPage('INBOX');
    expect(cached?.historyId).toBe('100');
    expect(cached?.nextPageToken).toBe('tok-next');
    expect(cached?.summaries.map((s) => s.id)).toEqual(['t1', 't2']);
  });

  it('overwrites the previous page for the same label', () => {
    writeThreadListPage('INBOX', '100', undefined, [summary('t1')]);
    writeThreadListPage('INBOX', '101', undefined, [summary('t3')]);

    const cached = readThreadListPage('INBOX');
    expect(cached?.historyId).toBe('101');
    expect(cached?.nextPageToken).toBeUndefined();
    expect(cached?.summaries.map((s) => s.id)).toEqual(['t3']);
  });

  it('keeps labels independent', () => {
    writeThreadListPage('INBOX', '100', undefined, [summary('t1')]);
    writeThreadListPage('Label_15', '100', undefined, [summary('t9')]);

    expect(readThreadListPage('Label_15')?.summaries[0]?.id).toBe('t9');
    expect(readThreadListPage('INBOX')?.summaries[0]?.id).toBe('t1');
    expect(readThreadListPage('Label_10')).toBeUndefined();
  });
});

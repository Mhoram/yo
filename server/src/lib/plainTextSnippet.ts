// Gmail's API returns message snippets HTML-entity-encoded ("We&#39;re"),
// regardless of the request format. List views want plain text, so decode
// entities and strip any tags. Applied at the API boundary: existing
// sender_approvals rows already store encoded strings and stay readable
// without a DB migration.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function plainTextSnippet(raw: string): string {
  let s = raw;
  // Real tags only appear in the input as escaped text (&lt;...&gt;); this
  // regex only ever matches actual markup.
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
  s = s.replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
  return s.replace(/\s+/g, ' ').trim();
}

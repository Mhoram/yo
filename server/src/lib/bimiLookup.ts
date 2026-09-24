import { promises as dns } from 'dns';

// BIMI (Brand Indicators for Message Identification) is the actual piece of
// email metadata a sender's logo can come from: the sending domain publishes
// a TXT record at `default._bimi.<domain>` pointing at a verified SVG logo.
// Gmail/Yahoo/Apple Mail already render these next to messages; this reuses
// the same mechanism instead of guessing a logo from message content.
// https://bimigroup.org/

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  logoUrl: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
// Dedupes concurrent lookups for the same domain: several thread rows from
// the same sender can all ask for a logo at once before the first DNS query
// (and its cache write) has come back.
const inFlight = new Map<string, Promise<string | null>>();

export function extractDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

// Exported for testing: pure parsing, no DNS involved.
export function parseBimiRecord(record: string): string | null {
  if (!/^v=BIMI1/i.test(record.trim())) return null;
  const match = record.match(/(?:^|;)\s*l=([^;]+)/i);
  if (!match) return null;

  const url = match[1].trim();
  try {
    const parsed = new URL(url);
    // The BIMI spec requires https and an SVG Tiny PS logo, so rejecting
    // anything else means the client only ever gets handed a safe <img> src.
    if (parsed.protocol !== 'https:') return null;
    if (!parsed.pathname.toLowerCase().endsWith('.svg')) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchBimiLogo(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveTxt(`default._bimi.${domain}`);
    for (const chunks of records) {
      const logoUrl = parseBimiRecord(chunks.join(''));
      if (logoUrl) return logoUrl;
    }
    return null;
  } catch {
    // No BIMI record (ENOTFOUND/ENODATA; the overwhelming majority of
    // domains) or a transient DNS error. Either way: no logo, and the
    // negative result is cached same as a positive one below so a sender
    // without BIMI doesn't cost a fresh DNS query on every request.
    return null;
  }
}

export async function lookupBimiLogo(email: string): Promise<string | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  const cached = cache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.logoUrl;

  let promise = inFlight.get(domain);
  if (!promise) {
    promise = fetchBimiLogo(domain).finally(() => inFlight.delete(domain));
    inFlight.set(domain, promise);
  }

  const logoUrl = await promise;
  cache.set(domain, { logoUrl, expiresAt: Date.now() + CACHE_TTL_MS });
  return logoUrl;
}

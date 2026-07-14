import { archiveMetadataUrl, type CatalogEntry } from '../consoles';
import type { Http } from '../../types';

// ── Legible network-failure helpers (shared with mcp/index.ts) ───────
//
// ROM/catalog availability is ultimately the archive.org item owner's concern,
// so when a fetch fails we surface WHICH host + a hint at the likely cause
// instead of a bare status — a user or the extension owner can self-diagnose
// from the message (and the matching `[games]` / `[http]` server log lines).

// "host/path" for an archive.org URL — the bare host + decoded file, not the
// full query, so an error/log line names the item without a wall of URL.
export function shortUrl(u: string): string {
  try { const x = new URL(u); return x.host + decodeURIComponent(x.pathname); } catch { return u; }
}

// A human, actionable hint for the common archive.org HTTP statuses.
export function httpStatusHint(status: number): string {
  if (status === 404 || status === 403) return 'the item or file is not available on archive.org (removed, or this catalog item has no playable ROM)';
  if (status === 429) return 'archive.org is rate-limiting downloads — wait a moment and try again';
  if (status === 502 || status === 503 || status === 504) return 'archive.org is temporarily unavailable — try again shortly';
  if (status >= 500) return 'archive.org returned a server error — try again shortly';
  if (status >= 400) return 'archive.org rejected the request';
  return 'unexpected response from archive.org';
}

// Build a console's game catalog from its archive.org item. The item stores one
// archive (.zip/.7z) per game with No-Intro filenames like
// "Super Mario World (USA).zip". We parse those into clean titles and collapse
// the many regional/revision variants of one game down to the single best one,
// so the picker shows ~one recognizable entry per game rather than thousands.

interface ArchiveFile {
  name: string;
  source?: string;
}

// Region preference (lower = better) read from a No-Intro flag like "(USA)".
function regionScore(flags: string[]): number {
  const f = flags.join(' ').toLowerCase();
  if (f.includes('usa')) return 0;
  if (f.includes('world')) return 1;
  if (f.includes('europe')) return 2;
  if (f.includes('japan')) return 3;
  return 4;
}

// Variants that aren't the game people mean — pirates, hacks, homebrew, betas.
// We give these a huge penalty so a clean release always wins its group, and a
// game whose ONLY variants are these (score stays above DROP) is left out.
const BAD_FLAGS = ['beta', 'proto', 'demo', 'sample', 'pirate', 'aftermarket', 'unl', 'hack', 'test program', 'program'];
// Re-release wrappers (Virtual Console, etc.): real games, but prefer the plain
// original on a tie, so only a tiny nudge.
const REISSUE_FLAGS = ['virtual console', 'e-reader', 'switch online', 'genesis mini', 'classic', 'collection', 'wii', '3ds'];
const BAD_PENALTY = 1000;
const DROP_SCORE = BAD_PENALTY;

function flagPenalty(flags: string[]): number {
  const f = flags.join(' ').toLowerCase();
  let p = 0;
  for (const bad of BAD_FLAGS) if (f.includes(bad)) p += BAD_PENALTY;
  for (const re of REISSUE_FLAGS) if (f.includes(re)) p += 1;
  return p;
}

// No-Intro often writes "Legend of Zelda, The" — flip the trailing article so
// the display title reads naturally.
function fixArticle(base: string): string {
  const m = base.match(/^(.*),\s+(The|A|An|Le|La|Les|Los|El|Die|Der|Das)$/);
  return m ? `${m[2]} ${m[1]}` : base;
}

interface Parsed {
  file: string;
  base: string;      // name before the first "(...)"
  title: string;     // display title (article-fixed)
  key: string;       // dedupe key (normalized base)
  score: number;
}

function parse(name: string): Parsed | null {
  const noExt = name.replace(/\.(zip|7z)$/i, '');
  if (!noExt || /\[BIOS\]/i.test(noExt)) return null;
  const flags = Array.from(noExt.matchAll(/\(([^)]*)\)/g)).map((m) => m[1]);
  const base = noExt.replace(/\s*\([^)]*\)/g, '').trim();
  if (!base) return null;
  const title = fixArticle(base);
  const key = base.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { file: name, base, title, key, score: regionScore(flags) + flagPenalty(flags) };
}

export function parseCatalog(files: ArchiveFile[]): CatalogEntry[] {
  const best = new Map<string, Parsed>();
  for (const f of files) {
    if (f.source && f.source !== 'original') continue;
    if (!/\.(zip|7z)$/i.test(f.name)) continue;
    const p = parse(f.name);
    if (!p) continue;
    const prior = best.get(p.key);
    if (!prior || p.score < prior.score) best.set(p.key, p);
  }
  return Array.from(best.values())
    .filter((p) => p.score < DROP_SCORE) // a game with only pirate/hack/beta variants drops out
    .map((p) => ({ file: p.file, title: p.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function fetchCatalogEntries(http: Http, item: string): Promise<CatalogEntry[]> {
  const url = archiveMetadataUrl(item);
  let res;
  try {
    res = await http.fetch({ url, method: null, headers: null, body: null, timeoutMs: 45_000, responseType: null });
  } catch (err: any) {
    // A THROWN error is our network/guard layer (timeout, SSRF/allowlist, DNS),
    // not an archive.org status — name the host so the cause is unambiguous.
    throw new Error(`couldn't reach ${shortUrl(url)}: ${err?.message || String(err)}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`archive.org metadata HTTP ${res.status} for item "${item}" — ${httpStatusHint(res.status)}`);
  }
  let data: { files?: ArchiveFile[] };
  try { data = JSON.parse(res.body); } catch { throw new Error(`archive.org metadata for "${item}" was not valid JSON`); }
  const entries = parseCatalog(data.files || []);
  if (entries.length === 0) throw new Error(`no playable games found in archive item "${item}"`);
  return entries;
}

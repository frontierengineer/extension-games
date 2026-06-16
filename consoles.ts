// The consoles this application can emulate, and where each one's games come
// from. Shared by the browser ui/ and the host-side mcp/ capability (it has no
// imports so it compiles cleanly in both the esbuild bundle and ts-node).
//
// Games are NOT bundled. For each console we point at one archive.org item — a
// No-Intro set that stores one archive (.zip/.7z) per game. The host capability
// enumerates that item's file list into a searchable catalog and, on request,
// downloads a single game's archive server-side (no browser CORS limit) and
// hands the bytes to EmulatorJS, which extracts and runs it.

export interface ConsoleSpec {
  id: string;
  label: string;
  // EmulatorJS core name (https://emulatorjs.org/docs/systems).
  core: string;
  // archive.org item identifier whose files are per-game archives.
  archiveItem: string;
  // Extensions to hint in the "bring your own ROM" file picker.
  romExtensions: string[];
}

export const CONSOLES: ConsoleSpec[] = [
  // Nintendo — home consoles
  { id: 'nes', label: 'NES', core: 'nes', archiveItem: 'ef_nintendo_entertainment_-system_-no-intro_2024-04-23', romExtensions: ['.nes', '.zip'] },
  { id: 'snes', label: 'SNES', core: 'snes', archiveItem: 'ef_nintendo_snes_no-intro_2024-04-20', romExtensions: ['.sfc', '.smc', '.zip'] },
  // N64 runs single-threaded here (the browser page isn't cross-origin isolated,
  // so SharedArrayBuffer/threads are unavailable) — fine for most titles, can be
  // heavy on the demanding ones. ROMs are also much larger than cartridge sets.
  { id: 'n64', label: 'Nintendo 64', core: 'n64', archiveItem: 'ef_nintendo_64_no-intro_2024-02-10', romExtensions: ['.z64', '.n64', '.v64', '.zip'] },
  // Nintendo — handhelds
  { id: 'gb', label: 'Game Boy', core: 'gb', archiveItem: 'ef_Nintendo_Gameboy_No-Intro_2024-04-23', romExtensions: ['.gb', '.zip'] },
  { id: 'gbc', label: 'Game Boy Color', core: 'gb', archiveItem: 'No-Intro_GBC', romExtensions: ['.gbc', '.zip'] },
  { id: 'gba', label: 'Game Boy Advance', core: 'gba', archiveItem: 'No-Intro_GBA', romExtensions: ['.gba', '.zip'] },
  // Sega
  { id: 'genesis', label: 'Genesis / Mega Drive', core: 'segaMD', archiveItem: 'ef_mega_genesis_no-intro_2024-04-21', romExtensions: ['.md', '.gen', '.bin', '.zip'] },
  { id: 'sms', label: 'Master System', core: 'segaMS', archiveItem: 'ef_sms_No-Intro_2024-03-08', romExtensions: ['.sms', '.zip'] },
  { id: 'gg', label: 'Game Gear', core: 'segaGG', archiveItem: 'ef_sega_game_gear_no-intro_2024-02-21', romExtensions: ['.gg', '.zip'] },
];

export const DEFAULT_CONSOLE = 'nes';

export function consoleSpec(id: string): ConsoleSpec | undefined {
  return CONSOLES.find((c) => c.id === id);
}

export function consoleLabel(id: string): string {
  return consoleSpec(id)?.label ?? id;
}

export function consoleCore(id: string): string {
  return consoleSpec(id)?.core ?? 'nes';
}

// ── archive.org endpoints ───────────────────────────────────────────

export function archiveMetadataUrl(item: string): string {
  return `https://archive.org/metadata/${item}`;
}

export function archiveDownloadUrl(item: string, file: string): string {
  return `https://archive.org/download/${item}/${encodeURIComponent(file)}`;
}

// ── Catalog shape (written by mcp/, read by ui/) ─────────────────────

// One installable game: `file` is the archive name on archive.org (the download
// handle); `title` is the cleaned display name (region/flags stripped).
export interface CatalogEntry {
  file: string;
  title: string;
}

export interface Catalog {
  builtAt: string;   // ISO timestamp
  item: string;      // archive.org identifier it was built from
  games?: CatalogEntry[];
  error?: string;    // set instead of games when the build failed
}

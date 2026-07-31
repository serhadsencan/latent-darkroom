import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');

// Load .env if present (built-in loader, Node 21.7+).
try {
  process.loadEnvFile(path.join(repoRoot, '.env'));
} catch {
  // No .env — fall back to environment variables or defaults.
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * Root folders to scan, separated by ":".
 *
 * Colon rather than comma because macOS paths routinely contain spaces
 * ("Lightroom Saved Photos") but almost never colons.
 */
export const photoRoots: string[] = (process.env.PHOTO_ROOTS ?? '')
  .split(':')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => path.resolve(expandHome(s)));

export const cacheDir = path.resolve(
  expandHome(process.env.LD_CACHE_DIR ?? path.join(repoRoot, '.cache')),
);
export const thumbDir = path.join(cacheDir, 'thumbs');
export const dbPath = path.join(cacheDir, 'library.db');

export const port = Number(process.env.PORT ?? 5174);

/** Fixed thumbnail widths. Clients ask for the nearest bucket. */
export const thumbSizes = [320, 640, 1280, 2560] as const;

export const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif']);
export const rawExts = new Set(['.raf', '.dng', '.nef', '.cr2', '.cr3', '.arw', '.orf', '.rw2']);
export const allExts = new Set([...imageExts, ...rawExts]);

/** Directories the scanner never descends into. */
export const skipDirs = new Set([
  '.cache',
  'node_modules',
  '.git',
  '.Trash',
  'Lightroom Library.lrlibrary',
  'Photos Library.photoslibrary',
]);

export function ensureDirs(): void {
  fs.mkdirSync(thumbDir, { recursive: true });
}

/** Guard against path traversal: a path must live under one of the configured roots. */
export function isUnderRoots(p: string): boolean {
  const resolved = path.resolve(p);
  return photoRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

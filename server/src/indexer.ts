import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import exifr from 'exifr';
import { allExts, photoRoots, rawExts, skipDirs } from './config.ts';
import { db, setMeta } from './db.ts';
import { parseFujiFilmSimulation } from './fuji.ts';
import { readDecodable, readDimensions, thumbPath, writeThumb } from './thumbs.ts';

export type ScanState = {
  running: boolean;
  found: number;
  processed: number;
  skipped: number;
  failed: number;
  startedAt: number | null;
  finishedAt: number | null;
  current: string | null;
  error: string | null;
};

export const scanState: ScanState = {
  running: false,
  found: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  current: null,
  error: null,
};

export function photoId(absPath: string): string {
  return crypto.createHash('sha1').update(absPath).digest('hex');
}

type FoundFile = { abs: string; root: string; ext: string };

async function walk(root: string, out: FoundFile[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return; // no permission / removed — skip quietly
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      await walk(abs, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (allExts.has(ext)) out.push({ abs, root: '', ext });
    }
  }
}

const EXIF_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  makerNote: true,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
  mergeOutput: true,
} as const;

const upsert = db.prepare(`
  INSERT INTO photos (
    id, path, root, rel, dir, name, ext, kind, size, mtime,
    width, height, orientation, taken_at,
    camera_make, camera_model, lens, iso, aperture, shutter, focal, focal35,
    film_sim, gps_lat, gps_lon, exif_json, indexed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET
    size = excluded.size, mtime = excluded.mtime,
    width = excluded.width, height = excluded.height, orientation = excluded.orientation,
    taken_at = excluded.taken_at, camera_make = excluded.camera_make,
    camera_model = excluded.camera_model, lens = excluded.lens, iso = excluded.iso,
    aperture = excluded.aperture, shutter = excluded.shutter, focal = excluded.focal,
    focal35 = excluded.focal35, film_sim = excluded.film_sim,
    gps_lat = excluded.gps_lat, gps_lon = excluded.gps_lon,
    exif_json = excluded.exif_json, indexed_at = excluded.indexed_at
`);

const selectFresh = db.prepare('SELECT mtime, size FROM photos WHERE id = ?');

/** node:sqlite rejects undefined; coerce anything non-numeric to null. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : null;
}

async function indexOne(file: FoundFile, force: boolean): Promise<'ok' | 'skip' | 'fail'> {
  const { abs, root, ext } = file;
  const id = photoId(abs);
  const stat = await fs.stat(abs);
  const mtime = Math.floor(stat.mtimeMs);

  if (!force) {
    const existing = selectFresh.get(id) as { mtime: number; size: number } | undefined;
    if (existing && existing.mtime === mtime && existing.size === stat.size) {
      // Record is fresh; if the small thumbnail also survives, skip the file entirely.
      try {
        await fs.access(thumbPath(id, 320));
        return 'skip';
      } catch {
        // thumbnail was deleted — regenerate
      }
    }
  }

  const input = await readDecodable(abs, ext);
  if (!input) return 'fail'; // no preview could be extracted from the RAW

  const dims = await readDimensions(input);

  let exif: Record<string, unknown> | undefined;
  try {
    exif = (await exifr.parse(input, EXIF_OPTIONS)) ?? undefined;
  } catch {
    exif = undefined;
  }

  const taken = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.ModifyDate;
  const takenAt = taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.getTime() : mtime;

  // Keep the raw makerNote out of exif_json — large and unreadable.
  const { makerNote, ...exifRest } = exif ?? {};
  const filmSim = parseFujiFilmSimulation(makerNote as Uint8Array | undefined);

  const rel = path.relative(root, abs);
  upsert.run(
    id,
    abs,
    root,
    rel,
    path.dirname(rel) === '.' ? '' : path.dirname(rel),
    path.basename(abs),
    ext,
    rawExts.has(ext) ? 'raw' : 'image',
    stat.size,
    mtime,
    dims?.width ?? null,
    dims?.height ?? null,
    dims?.orientation ?? null,
    takenAt,
    str(exif?.Make),
    str(exif?.Model),
    str(exif?.LensModel) ?? str(exif?.Lens) ?? str(exif?.LensMake),
    num(exif?.ISO),
    num(exif?.FNumber),
    num(exif?.ExposureTime),
    num(exif?.FocalLength),
    num(exif?.FocalLengthIn35mmFormat),
    filmSim,
    num(exif?.latitude),
    num(exif?.longitude),
    JSON.stringify(exifRest, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
    Date.now(),
  );

  // Pre-render the grid's default size so first browse is immediate.
  try {
    await writeThumb(input, id, 320);
  } catch {
    // thumbnail failed but the record is valid — it retries on request
  }

  return 'ok';
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function scanLibrary(options: { force?: boolean } = {}): Promise<ScanState> {
  if (scanState.running) return scanState;
  if (photoRoots.length === 0) {
    scanState.error = 'PHOTO_ROOTS is not set — add at least one folder to .env.';
    return scanState;
  }

  Object.assign(scanState, {
    running: true,
    found: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    startedAt: Date.now(),
    finishedAt: null,
    current: null,
    error: null,
  });

  try {
    const files: FoundFile[] = [];
    for (const root of photoRoots) {
      const rootFiles: FoundFile[] = [];
      await walk(root, rootFiles);
      for (const f of rootFiles) files.push({ ...f, root });
    }
    scanState.found = files.length;

    const concurrency = Math.max(2, Math.min(8, os.availableParallelism() - 1));
    await pool(files, concurrency, async (file) => {
      scanState.current = file.abs;
      try {
        const result = await indexOne(file, options.force ?? false);
        if (result === 'ok') scanState.processed++;
        else if (result === 'skip') scanState.skipped++;
        else scanState.failed++;
      } catch {
        scanState.failed++;
      }
    });

    // Drop rows whose files no longer exist on disk.
    const known = db.prepare('SELECT id, path FROM photos').all() as { id: string; path: string }[];
    const alive = new Set(files.map((f) => f.abs));
    const del = db.prepare('DELETE FROM photos WHERE id = ?');
    for (const row of known) {
      if (!alive.has(row.path)) del.run(row.id);
    }

    setMeta('lastScanAt', String(Date.now()));
  } catch (err) {
    scanState.error = err instanceof Error ? err.message : String(err);
  } finally {
    scanState.running = false;
    scanState.current = null;
    scanState.finishedAt = Date.now();
  }

  return scanState;
}

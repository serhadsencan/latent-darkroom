import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { isUnderRoots, thumbSizes } from './config.ts';
import { db } from './db.ts';
import { thumbPath } from './thumbs.ts';

const run = promisify(execFile);

/** Finder handles hundreds per call; still chunked to keep each call bounded. */
const BATCH_SIZE = 50;

/**
 * Finder automation can hang indefinitely behind a pending permission dialog or a
 * busy Finder. Without a timeout the request never returns and the UI stays stuck
 * on "moving…".
 */
const TRASH_TIMEOUT_MS = 20_000;

export class TrashUnavailableError extends Error {
  constructor() {
    super(
      'Finder did not respond. macOS may be waiting on an automation or Trash ' +
        'access prompt — approve any dialog on screen and try again.',
    );
    this.name = 'TrashUnavailableError';
  }
}

/**
 * Moves files to the macOS Trash.
 *
 * Finder is used rather than `rm` or a manual move into ~/.Trash because only
 * Finder records the original-location metadata that "Put Back" needs. That keeps
 * the operation fully reversible by the user.
 *
 * Paths travel via argv instead of being interpolated into the script text, so
 * filenames containing quotes or backslashes cannot inject AppleScript.
 */
async function moveToTrash(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const script = [
    'on run argv',
    'set targets to {}',
    'repeat with p in argv',
    'set end of targets to POSIX file (p as text)',
    'end repeat',
    'tell application "Finder" to delete targets',
    'end run',
  ].flatMap((line) => ['-e', line]);

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    try {
      await run('osascript', [...script, '--', ...batch], { timeout: TRASH_TIMEOUT_MS });
    } catch (err) {
      // On timeout execFile kills the process and rejects with killed: true.
      const killed = typeof err === 'object' && err !== null && 'killed' in err && err.killed === true;
      if (killed) throw new TrashUnavailableError();
      throw err;
    }
  }
}

export type TrashResult = {
  trashed: string[];
  /** id → reason. Missing file, outside the roots, or Finder refused. */
  failed: Record<string, string>;
};

async function removeThumbs(id: string): Promise<void> {
  await Promise.all(
    thumbSizes.map((size) => fs.rm(thumbPath(id, size), { force: true }).catch(() => {})),
  );
}

/**
 * Moves the given ids' files to the Trash and drops them from the index.
 * The index is only cleaned up for files that actually moved.
 */
export async function trashPhotos(ids: string[]): Promise<TrashResult> {
  const result: TrashResult = { trashed: [], failed: {} };
  if (ids.length === 0) return result;

  const select = db.prepare('SELECT id, path FROM photos WHERE id = ?');
  const movable: { id: string; path: string }[] = [];

  for (const id of ids) {
    const row = select.get(id) as { id: string; path: string } | undefined;
    if (!row) {
      result.failed[id] = 'not-in-index';
      continue;
    }
    // The index may be stale; never delete a path outside the configured roots.
    if (!isUnderRoots(row.path)) {
      result.failed[id] = 'outside-roots';
      continue;
    }
    try {
      await fs.access(row.path);
    } catch {
      result.failed[id] = 'file-missing';
      continue;
    }
    movable.push(row);
  }

  if (movable.length > 0) {
    try {
      await moveToTrash(movable.map((m) => m.path));
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 200) : 'finder-error';
      for (const item of movable) result.failed[item.id] = reason;
      return result;
    }
  }

  const deletePhoto = db.prepare('DELETE FROM photos WHERE id = ?');
  const deleteMeta = db.prepare('DELETE FROM user_meta WHERE id = ?');
  const deleteGeo = db.prepare('DELETE FROM user_geo WHERE id = ?');
  // A trashed frame must leave grids and groups too, or it lingers as a gap.
  const deletePlan = db.prepare('DELETE FROM grid_items WHERE photo_id = ?');
  const deleteGroup = db.prepare('DELETE FROM group_items WHERE photo_id = ?');

  for (const item of movable) {
    deletePhoto.run(item.id);
    deleteMeta.run(item.id);
    deleteGeo.run(item.id);
    deletePlan.run(item.id);
    deleteGroup.run(item.id);
    await removeThumbs(item.id);
    result.trashed.push(item.id);
  }

  return result;
}

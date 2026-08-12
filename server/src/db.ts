import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, ensureDirs } from './config.ts';

ensureDirs();

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS photos (
    id            TEXT PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    root          TEXT NOT NULL,
    rel           TEXT NOT NULL,
    dir           TEXT NOT NULL,
    name          TEXT NOT NULL,
    ext           TEXT NOT NULL,
    kind          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    mtime         INTEGER NOT NULL,
    width         INTEGER,
    height        INTEGER,
    orientation   INTEGER,
    taken_at      INTEGER,
    camera_make   TEXT,
    camera_model  TEXT,
    lens          TEXT,
    iso           INTEGER,
    aperture      REAL,
    shutter       REAL,
    focal         REAL,
    focal35       REAL,
    film_sim      TEXT,
    gps_lat       REAL,
    gps_lon       REAL,
    exif_json     TEXT,
    indexed_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_photos_taken   ON photos(taken_at DESC);
  CREATE INDEX IF NOT EXISTS idx_photos_dir     ON photos(dir);
  CREATE INDEX IF NOT EXISTS idx_photos_model   ON photos(camera_model);
  CREATE INDEX IF NOT EXISTS idx_photos_lens    ON photos(lens);
  CREATE INDEX IF NOT EXISTS idx_photos_film    ON photos(film_sim);

  -- User-supplied rating/flag lives in its own table so a rescan never wipes it.
  CREATE TABLE IF NOT EXISTS user_meta (
    id         TEXT PRIMARY KEY,
    rating     INTEGER NOT NULL DEFAULT 0,
    flag       TEXT,
    updated_at INTEGER NOT NULL
  );

  -- User-assigned location. It does not overwrite EXIF, it takes precedence over it.
  -- Original files are never touched, so a wrong assignment is undone by one DELETE.
  --   source = 'manual'       → placed by hand on the map
  --   source = 'interpolated' → derived from time-adjacent located frames
  CREATE TABLE IF NOT EXISTS user_geo (
    id         TEXT PRIMARY KEY,
    lat        REAL NOT NULL,
    lon        REAL NOT NULL,
    source     TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Saved Instagram grids. Ordering lives in the position column rather than row
  -- order, which SQLite does not guarantee.
  CREATE TABLE IF NOT EXISTS grids (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS grid_items (
    grid_id  TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (grid_id, photo_id)
  );

  CREATE INDEX IF NOT EXISTS idx_grid_items ON grid_items(grid_id, position);

  -- Groups: general-purpose collections. Unlike a grid, membership is what matters,
  -- not order, so items carry an added_at rather than a position.
  CREATE TABLE IF NOT EXISTS groups (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    note       TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_items (
    group_id TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, photo_id)
  );

  CREATE INDEX IF NOT EXISTS idx_group_items ON group_items(group_id, added_at DESC);

  -- Predecessor of the tables above: a single unnamed plan.
  CREATE TABLE IF NOT EXISTS grid_plan (
    photo_id   TEXT PRIMARY KEY,
    position   INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export type PhotoRow = {
  id: string;
  path: string;
  root: string;
  rel: string;
  dir: string;
  name: string;
  ext: string;
  kind: string;
  size: number;
  mtime: number;
  width: number | null;
  height: number | null;
  orientation: number | null;
  taken_at: number | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  iso: number | null;
  aperture: number | null;
  shutter: number | null;
  focal: number | null;
  focal35: number | null;
  film_sim: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  exif_json: string | null;
  indexed_at: number;
  rating: number | null;
  flag: string | null;
  gps_source: string | null;
};

/**
 * Adds a column to an existing table if it is not already there.
 *
 * `CREATE TABLE IF NOT EXISTS` silently does nothing once a table exists, so new
 * columns on shipped tables need this rather than a schema edit.
 */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('groups', 'note', 'TEXT');

/**
 * Moves the old single plan into a named grid, once.
 *
 * Runs before anything reads the new tables so an existing plan is never lost to
 * the schema change; the source rows are cleared so it cannot run twice.
 */
function migrateLegacyPlan(): void {
  const legacy = db.prepare('SELECT photo_id FROM grid_plan ORDER BY position ASC').all() as {
    photo_id: string;
  }[];
  if (legacy.length === 0) return;

  const now = Date.now();
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO grids (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    'My grid',
    now,
    now,
  );

  const insert = db.prepare('INSERT INTO grid_items (grid_id, photo_id, position) VALUES (?, ?, ?)');
  legacy.forEach((row, index) => insert.run(id, row.photo_id, index));
  db.prepare('DELETE FROM grid_plan').run();
}

migrateLegacyPlan();

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}

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

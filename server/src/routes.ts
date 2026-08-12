import crypto from 'node:crypto';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { isUnderRoots, photoRoots } from './config.ts';
import { db, getMeta, type PhotoRow } from './db.ts';
import { resolvePastedLocation, searchPlaces } from './geocode.ts';
import { interpolateMissingLocations } from './geo.ts';
import { scanLibrary, scanState } from './indexer.ts';
import { ensureThumb, nearestSize, readDecodable } from './thumbs.ts';
import { trashPhotos } from './trash.ts';

const SORTS: Record<string, string> = {
  taken: 'p.taken_at',
  added: 'p.indexed_at',
  name: 'p.name',
  size: 'p.size',
  rating: 'COALESCE(u.rating, 0)',
};

/** Every photo row is always joined with both user tables. */
const JOINS = `
  LEFT JOIN user_meta u ON u.id = p.id
  LEFT JOIN user_geo  g ON g.id = p.id
`;

// Location columns return the *effective* value: the user assignment if there is
// one, otherwise EXIF. A null gps_source means the location came from the file.
const SELECT_COLUMNS = `
  p.id, p.rel, p.dir, p.name, p.ext, p.kind, p.size, p.mtime,
  p.width, p.height, p.taken_at, p.camera_make, p.camera_model, p.lens,
  p.iso, p.aperture, p.shutter, p.focal, p.focal35, p.film_sim,
  COALESCE(g.lat, p.gps_lat) AS gps_lat,
  COALESCE(g.lon, p.gps_lon) AS gps_lon,
  g.source AS gps_source,
  COALESCE(u.rating, 0) AS rating, u.flag
`;

/** SQL for the effective location — shared by filters and counts. */
const EFFECTIVE_LAT = 'COALESCE(g.lat, p.gps_lat)';

type ListQuery = {
  dir?: string;
  camera?: string;
  lens?: string;
  film?: string;
  year?: string;
  kind?: string;
  minRating?: string;
  gps?: string;
  q?: string;
  sort?: string;
  order?: string;
  limit?: string;
  offset?: string;
};

/** Reject invalid coordinates rather than silently storing something that breaks the map. */
function validateCoords(lat: unknown, lon: unknown): string | null {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'invalid-lat';
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return 'invalid-lon';
  return null;
}

/** Turns filters into WHERE fragments. Every value is bound as a parameter. */
function buildFilters(query: ListQuery): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (query.dir) {
    // The folder and everything beneath it.
    clauses.push('(p.dir = ? OR p.dir LIKE ?)');
    params.push(query.dir, `${query.dir}/%`);
  }
  if (query.camera) {
    clauses.push('p.camera_model = ?');
    params.push(query.camera);
  }
  if (query.lens) {
    clauses.push('p.lens = ?');
    params.push(query.lens);
  }
  if (query.film) {
    clauses.push('p.film_sim = ?');
    params.push(query.film);
  }
  if (query.year) {
    clauses.push("strftime('%Y', p.taken_at / 1000, 'unixepoch') = ?");
    params.push(query.year);
  }
  if (query.kind === 'raw' || query.kind === 'image') {
    clauses.push('p.kind = ?');
    params.push(query.kind);
  }
  if (query.minRating) {
    const min = Number(query.minRating);
    if (Number.isFinite(min) && min > 0) {
      clauses.push('COALESCE(u.rating, 0) >= ?');
      params.push(min);
    }
  }
  if (query.gps === '1') {
    clauses.push(`${EFFECTIVE_LAT} IS NOT NULL`);
  } else if (query.gps === '0') {
    clauses.push(`${EFFECTIVE_LAT} IS NULL`);
  }
  if (query.q) {
    const term = `%${query.q}%`;
    clauses.push('(p.name LIKE ? OR p.dir LIKE ? OR p.camera_model LIKE ? OR p.lens LIKE ? OR p.film_sim LIKE ?)');
    params.push(term, term, term, term, term);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function registerRoutes(app: FastifyInstance): void {
  app.get('/api/status', async () => {
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(p.kind = 'raw') AS raws,
                SUM(${EFFECTIVE_LAT} IS NOT NULL) AS geotagged,
                SUM(p.gps_lat IS NOT NULL) AS geotagged_exif,
                SUM(g.source = 'manual') AS geotagged_manual,
                SUM(g.source = 'interpolated') AS geotagged_interpolated
         FROM photos p ${JOINS}`,
      )
      .get() as Record<string, number | null> & { total: number };
    return {
      roots: photoRoots,
      rootsConfigured: photoRoots.length > 0,
      total: counts.total,
      raws: counts.raws ?? 0,
      geotagged: counts.geotagged ?? 0,
      geotaggedExif: counts.geotagged_exif ?? 0,
      geotaggedManual: counts.geotagged_manual ?? 0,
      geotaggedInterpolated: counts.geotagged_interpolated ?? 0,
      lastScanAt: getMeta('lastScanAt') ? Number(getMeta('lastScanAt')) : null,
      scan: scanState,
    };
  });

  app.get('/api/scan', async () => scanState);

  app.post<{ Body?: { force?: boolean } }>('/api/scan', async (req) => {
    if (scanState.running) return { started: false, reason: 'already-running', scan: scanState };
    // Run in the background: the request returns immediately, progress via /api/scan.
    void scanLibrary({ force: req.body?.force === true });
    return { started: true, scan: scanState };
  });

  app.get('/api/facets', async () => {
    const list = (sql: string) =>
      (db.prepare(sql).all() as { value: string | null; count: number }[])
        .filter((r) => r.value !== null && r.value !== '')
        .map((r) => ({ value: r.value as string, count: r.count }));

    return {
      folders: list(
        'SELECT dir AS value, COUNT(*) AS count FROM photos GROUP BY dir ORDER BY dir',
      ),
      cameras: list(
        'SELECT camera_model AS value, COUNT(*) AS count FROM photos GROUP BY camera_model ORDER BY count DESC',
      ),
      lenses: list('SELECT lens AS value, COUNT(*) AS count FROM photos GROUP BY lens ORDER BY count DESC'),
      films: list('SELECT film_sim AS value, COUNT(*) AS count FROM photos GROUP BY film_sim ORDER BY count DESC'),
      years: list(
        "SELECT strftime('%Y', taken_at / 1000, 'unixepoch') AS value, COUNT(*) AS count FROM photos GROUP BY value ORDER BY value DESC",
      ),
    };
  });

  app.get<{ Querystring: ListQuery }>('/api/photos', async (req) => {
    const { where, params } = buildFilters(req.query);
    const sortKey = SORTS[req.query.sort ?? 'taken'] ?? SORTS.taken;
    const order = req.query.order?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(Number(req.query.limit ?? 500), 1), 2000);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM photos p ${JOINS} ${where}`)
        .get(...params) as { n: number }
    ).n;

    const rows = db
      .prepare(
        `SELECT ${SELECT_COLUMNS}
         FROM photos p ${JOINS}
         ${where}
         ORDER BY ${sortKey} ${order}, p.name ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as PhotoRow[];

    return { total, limit, offset, photos: rows };
  });

  app.get<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    const row = db
      .prepare(
        `SELECT ${SELECT_COLUMNS}, p.path, p.exif_json, p.orientation, p.indexed_at
         FROM photos p ${JOINS} WHERE p.id = ?`,
      )
      .get(req.params.id) as (PhotoRow & { exif_json: string | null }) | undefined;

    if (!row) return reply.code(404).send({ error: 'not-found' });

    const { exif_json, path: _abs, ...rest } = row;
    return { ...rest, exif: exif_json ? JSON.parse(exif_json) : null };
  });

  app.put<{ Params: { id: string }; Body: { rating?: number; flag?: string | null } }>(
    '/api/photos/:id/meta',
    async (req, reply) => {
      const exists = db.prepare('SELECT 1 FROM photos WHERE id = ?').get(req.params.id);
      if (!exists) return reply.code(404).send({ error: 'not-found' });

      const rating = Math.min(Math.max(Math.round(req.body.rating ?? 0), 0), 5);
      const flag = req.body.flag === 'pick' || req.body.flag === 'reject' ? req.body.flag : null;

      db.prepare(
        `INSERT INTO user_meta (id, rating, flag, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET rating = excluded.rating, flag = excluded.flag, updated_at = excluded.updated_at`,
      ).run(req.params.id, rating, flag, Date.now());

      return { id: req.params.id, rating, flag };
    },
  );

  /** Assign a location to one photo. Passing null lat/lon clears it and falls back to EXIF. */
  app.put<{ Params: { id: string }; Body: { lat: number | null; lon: number | null } }>(
    '/api/photos/:id/geo',
    async (req, reply) => {
      const exists = db.prepare('SELECT 1 FROM photos WHERE id = ?').get(req.params.id);
      if (!exists) return reply.code(404).send({ error: 'not-found' });

      const { lat, lon } = req.body;
      if (lat === null || lon === null) {
        db.prepare('DELETE FROM user_geo WHERE id = ?').run(req.params.id);
        return { id: req.params.id, cleared: true };
      }

      const error = validateCoords(lat, lon);
      if (error) return reply.code(400).send({ error });

      db.prepare(
        `INSERT INTO user_geo (id, lat, lon, source, updated_at) VALUES (?, ?, ?, 'manual', ?)
         ON CONFLICT(id) DO UPDATE SET lat = excluded.lat, lon = excluded.lon,
           source = 'manual', updated_at = excluded.updated_at`,
      ).run(req.params.id, lat, lon, Date.now());

      return { id: req.params.id, lat, lon, source: 'manual' };
    },
  );

  /**
   * Bulk location assignment. The target can be described two ways:
   *  - `ids`: frames the user picked one by one (selection mode)
   *  - filters: a broad target like "every located-less frame in this folder";
   *    reuses the listing filter language so 900 ids need not travel in the body.
   */
  app.post<{ Body: ListQuery & { lat: number; lon: number; onlyMissing?: boolean; ids?: string[] } }>(
    '/api/geo/bulk',
    async (req, reply) => {
      const { lat, lon, onlyMissing = true, ids, ...filters } = req.body;
      const error = validateCoords(lat, lon);
      if (error) return reply.code(400).send({ error });

      let targets: { id: string }[];

      if (Array.isArray(ids)) {
        if (ids.length === 0) return { assigned: 0, lat, lon };
        // Never write unknown ids; with onlyMissing, skip anything already located.
        const placeholders = ids.map(() => '?').join(',');
        const missingClause = onlyMissing ? `AND ${EFFECTIVE_LAT} IS NULL` : '';
        targets = db
          .prepare(`SELECT p.id FROM photos p ${JOINS} WHERE p.id IN (${placeholders}) ${missingClause}`)
          .all(...ids) as { id: string }[];
      } else {
        const { where, params } = buildFilters(filters);
        const missingClause = onlyMissing ? `${EFFECTIVE_LAT} IS NULL` : '1=1';
        const scope = where ? `${where} AND ${missingClause}` : `WHERE ${missingClause}`;
        targets = db.prepare(`SELECT p.id FROM photos p ${JOINS} ${scope}`).all(...params) as { id: string }[];
      }

      const upsert = db.prepare(
        `INSERT INTO user_geo (id, lat, lon, source, updated_at) VALUES (?, ?, ?, 'manual', ?)
         ON CONFLICT(id) DO UPDATE SET lat = excluded.lat, lon = excluded.lon,
           source = 'manual', updated_at = excluded.updated_at`,
      );
      const now = Date.now();
      for (const target of targets) upsert.run(target.id, lat, lon, now);

      return { assigned: targets.length, lat, lon };
    },
  );

  /** Groups, most recently touched first. */
  app.get('/api/groups', async () => {
    const groups = db
      .prepare(
        `SELECT g.id, g.name, g.note, g.created_at, g.updated_at,
                COUNT(i.photo_id) AS count,
                (SELECT photo_id FROM group_items WHERE group_id = g.id ORDER BY added_at DESC LIMIT 1) AS cover
         FROM groups g
         LEFT JOIN group_items i ON i.group_id = g.id
         GROUP BY g.id
         ORDER BY g.updated_at DESC`,
      )
      .all();
    return { groups };
  });

  app.post<{ Body?: { name?: string } }>('/api/groups', async (req) => {
    const name = (req.body?.name ?? '').trim() || 'Untitled group';
    const now = Date.now();
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      id,
      name,
      now,
      now,
    );
    return { id, name, count: 0 };
  });

  /** A group's photos, newest addition first. */
  app.get<{ Params: { id: string } }>('/api/groups/:id', async (req, reply) => {
    const group = db.prepare('SELECT id, name, note FROM groups WHERE id = ?').get(req.params.id) as
      | { id: string; name: string; note: string | null }
      | undefined;
    if (!group) return reply.code(404).send({ error: 'not-found' });

    const photos = db
      .prepare(
        `SELECT ${SELECT_COLUMNS}
         FROM group_items gi
         JOIN photos p ON p.id = gi.photo_id
         ${JOINS}
         WHERE gi.group_id = ?
         ORDER BY gi.added_at DESC`,
      )
      .all(req.params.id) as PhotoRow[];

    return { ...group, photos };
  });

  /** Renames and/or sets the note. Either may be sent on its own. */
  app.put<{ Params: { id: string }; Body: { name?: string; note?: string | null } }>(
    '/api/groups/:id',
    async (req, reply) => {
      const exists = db.prepare('SELECT 1 FROM groups WHERE id = ?').get(req.params.id);
      if (!exists) return reply.code(404).send({ error: 'not-found' });

      const now = Date.now();
      const name = req.body?.name?.trim();
      if (name) db.prepare('UPDATE groups SET name = ?, updated_at = ? WHERE id = ?').run(name, now, req.params.id);

      // An empty note clears it, so undefined (absent) and '' mean different things.
      if (req.body?.note !== undefined) {
        const note = req.body.note?.trim() || null;
        db.prepare('UPDATE groups SET note = ?, updated_at = ? WHERE id = ?').run(note, now, req.params.id);
      }

      return db.prepare('SELECT id, name, note FROM groups WHERE id = ?').get(req.params.id);
    },
  );

  /**
   * Adds photos. Additive rather than replace-all: "add to a group" happens a
   * handful at a time, and two tabs adding at once should not clobber each other.
   */
  app.post<{ Params: { id: string }; Body: { ids?: string[] } }>(
    '/api/groups/:id/items',
    async (req, reply) => {
      const exists = db.prepare('SELECT 1 FROM groups WHERE id = ?').get(req.params.id);
      if (!exists) return reply.code(404).send({ error: 'not-found' });

      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) return reply.code(400).send({ error: 'ids-required' });

      const known = db.prepare('SELECT 1 FROM photos WHERE id = ?');
      const insert = db.prepare(
        `INSERT INTO group_items (group_id, photo_id, added_at) VALUES (?, ?, ?)
         ON CONFLICT(group_id, photo_id) DO NOTHING`,
      );
      const now = Date.now();

      let added = 0;
      for (const photoId of new Set(ids)) {
        if (!known.get(photoId)) continue;
        added += Number(insert.run(req.params.id, photoId, now).changes);
      }
      db.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(now, req.params.id);

      return { added };
    },
  );

  app.delete<{ Params: { id: string }; Body?: { ids?: string[] } }>(
    '/api/groups/:id/items',
    async (req, reply) => {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) return reply.code(400).send({ error: 'ids-required' });

      const remove = db.prepare('DELETE FROM group_items WHERE group_id = ? AND photo_id = ?');
      let removed = 0;
      for (const photoId of ids) removed += Number(remove.run(req.params.id, photoId).changes);
      db.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id);

      return { removed };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
    db.prepare('DELETE FROM group_items WHERE group_id = ?').run(req.params.id);
    const result = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
    return { removed: Number(result.changes) };
  });

  /** Saved grids, most recently touched first. */
  app.get('/api/grids', async () => {
    const grids = db
      .prepare(
        `SELECT g.id, g.name, g.created_at, g.updated_at,
                COUNT(i.photo_id) AS count,
                (SELECT photo_id FROM grid_items WHERE grid_id = g.id ORDER BY position ASC LIMIT 1) AS cover
         FROM grids g
         LEFT JOIN grid_items i ON i.grid_id = g.id
         GROUP BY g.id
         ORDER BY g.updated_at DESC`,
      )
      .all();
    return { grids };
  });

  app.post<{ Body?: { name?: string } }>('/api/grids', async (req) => {
    const name = (req.body?.name ?? '').trim() || 'Untitled grid';
    const now = Date.now();
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO grids (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      id,
      name,
      now,
      now,
    );
    return { id, name, count: 0 };
  });

  /**
   * One grid's photos, in posting order.
   *
   * Returns full photo rows rather than ids so a grid renders independently of
   * whatever the gallery is filtered to — a grid is its own thing.
   */
  app.get<{ Params: { id: string } }>('/api/grids/:id', async (req, reply) => {
    const grid = db.prepare('SELECT id, name FROM grids WHERE id = ?').get(req.params.id) as
      | { id: string; name: string }
      | undefined;
    if (!grid) return reply.code(404).send({ error: 'not-found' });

    const photos = db
      .prepare(
        `SELECT ${SELECT_COLUMNS}
         FROM grid_items gi
         JOIN photos p ON p.id = gi.photo_id
         ${JOINS}
         WHERE gi.grid_id = ?
         ORDER BY gi.position ASC`,
      )
      .all(req.params.id) as PhotoRow[];

    return { ...grid, photos };
  });

  /** Renames and/or replaces the contents. The UI always edits the whole list. */
  app.put<{ Params: { id: string }; Body: { name?: string; ids?: string[] } }>(
    '/api/grids/:id',
    async (req, reply) => {
      const exists = db.prepare('SELECT 1 FROM grids WHERE id = ?').get(req.params.id);
      if (!exists) return reply.code(404).send({ error: 'not-found' });

      const now = Date.now();
      let saved: number | undefined;
      let dropped: number | undefined;

      if (Array.isArray(req.body?.ids)) {
        const ids = req.body.ids;
        const known = db.prepare('SELECT 1 FROM photos WHERE id = ?');
        // Unknown ids are discarded: a grid pointing at photos that are no longer
        // indexed would render as silent gaps.
        const unique = [...new Set(ids.filter((id) => known.get(id)))];

        db.prepare('DELETE FROM grid_items WHERE grid_id = ?').run(req.params.id);
        const insert = db.prepare('INSERT INTO grid_items (grid_id, photo_id, position) VALUES (?, ?, ?)');
        unique.forEach((photoId, index) => insert.run(req.params.id, photoId, index));

        saved = unique.length;
        dropped = ids.length - unique.length;
      }

      const name = req.body?.name?.trim();
      if (name) db.prepare('UPDATE grids SET name = ?, updated_at = ? WHERE id = ?').run(name, now, req.params.id);
      else db.prepare('UPDATE grids SET updated_at = ? WHERE id = ?').run(now, req.params.id);

      return { id: req.params.id, saved, dropped };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/grids/:id', async (req) => {
    db.prepare('DELETE FROM grid_items WHERE grid_id = ?').run(req.params.id);
    const result = db.prepare('DELETE FROM grids WHERE id = ?').run(req.params.id);
    return { removed: Number(result.changes) };
  });

  /** Place search for the location picker. Proxied so Nominatim's policy is honoured. */
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/geocode', async (req, reply) => {
    const q = req.query.q ?? '';
    if (q.trim().length < 2) return { places: [] };

    const limit = Math.min(Math.max(Number(req.query.limit ?? 8), 1), 20);
    try {
      return { places: await searchPlaces(q, limit) };
    } catch (err) {
      // Upstream being slow or rate-limiting us must not read as "no such place".
      const message = err instanceof Error ? err.message : 'geocode-failed';
      return reply.code(502).send({ error: 'geocode-unavailable', detail: message });
    }
  });

  /**
   * Turns pasted input into a point: bare coordinates, a Google/Apple Maps URL, or
   * a short link the server expands. Lets the user search wherever they like and
   * bring the answer back, without this app consuming anyone's search API.
   */
  app.post<{ Body?: { input?: string } }>('/api/geocode/resolve', async (req, reply) => {
    const input = req.body?.input ?? '';
    if (!input.trim()) return { point: null };
    try {
      return { point: await resolvePastedLocation(input) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'resolve-failed';
      return reply.code(502).send({ error: 'resolve-failed', detail: message });
    }
  });

  /** How many photos lack a location per folder — used to pick an assignment target. */
  app.get('/api/geo/missing', async () => {
    const folders = db
      .prepare(
        `SELECT p.dir AS value, COUNT(*) AS count
         FROM photos p ${JOINS}
         WHERE ${EFFECTIVE_LAT} IS NULL
         GROUP BY p.dir ORDER BY count DESC`,
      )
      .all() as { value: string; count: number }[];
    const total = folders.reduce((sum, f) => sum + f.count, 0);
    return { total, folders };
  });

  /** Fill missing locations from time-adjacent located frames. */
  app.post<{ Body?: { maxGapMinutes?: number; dryRun?: boolean } }>('/api/geo/interpolate', async (req) =>
    interpolateMissingLocations({
      maxGapMinutes: req.body?.maxGapMinutes,
      dryRun: req.body?.dryRun,
    }),
  );

  /** Bulk-undo user assignments. Without a source, everything is removed. */
  app.delete<{ Querystring: { source?: string } }>('/api/geo', async (req) => {
    const source = req.query.source;
    const result =
      source === 'manual' || source === 'interpolated'
        ? db.prepare('DELETE FROM user_geo WHERE source = ?').run(source)
        : db.prepare('DELETE FROM user_geo').run();
    return { removed: Number(result.changes) };
  });

  /**
   * Moves the selected photos to the macOS Trash and drops them from the index.
   *
   * Deliberately restricted to an explicit id list — deleting by filter is not
   * allowed, because one wrong filter would send 900 frames away in a single click.
   */
  app.post<{ Body: { ids?: string[] } }>('/api/photos/trash', async (req, reply) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'ids-required' });
    }
    const result = await trashPhotos(ids);
    return {
      trashed: result.trashed.length,
      failed: result.failed,
      failedCount: Object.keys(result.failed).length,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { w?: string } }>('/api/thumb/:id', async (req, reply) => {
    const row = db.prepare('SELECT path, ext FROM photos WHERE id = ?').get(req.params.id) as
      | { path: string; ext: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'not-found' });

    const size = nearestSize(Number(req.query.w ?? 320) || 320);
    const file = await ensureThumb(row.path, row.ext, req.params.id, size);
    if (!file) return reply.code(415).send({ error: 'no-preview' });

    // Content is fixed per id+size (a changed file keeps its id but the scan catches mtime).
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.type('image/jpeg');
    return reply.send(createReadStream(file));
  });

  /** Large preview for the lightbox — a 2560px JPEG, never the original. */
  app.get<{ Params: { id: string } }>('/api/preview/:id', async (req, reply) => {
    const row = db.prepare('SELECT path, ext FROM photos WHERE id = ?').get(req.params.id) as
      | { path: string; ext: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'not-found' });

    const file = await ensureThumb(row.path, row.ext, req.params.id, 2560);
    if (!file) return reply.code(415).send({ error: 'no-preview' });

    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.type('image/jpeg');
    return reply.send(createReadStream(file));
  });

  /** The original file — for RAW this downloads the raw file itself. */
  app.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    '/api/original/:id',
    async (req, reply) => {
      const row = db.prepare('SELECT path, name, ext, kind FROM photos WHERE id = ?').get(req.params.id) as
        | { path: string; name: string; ext: string; kind: string }
        | undefined;
      if (!row) return reply.code(404).send({ error: 'not-found' });
      // The index can go stale or roots can change — re-validate on every request.
      if (!isUnderRoots(row.path) || !fs.existsSync(row.path)) {
        return reply.code(404).send({ error: 'file-missing' });
      }

      if (row.kind === 'raw' && req.query.download !== '1') {
        // Browsers cannot render RAW; serve the embedded JPEG instead.
        const buf = await readDecodable(row.path, row.ext);
        if (!buf) return reply.code(415).send({ error: 'no-preview' });
        reply.type('image/jpeg');
        return reply.send(buf);
      }

      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(row.name)}"`);
      reply.type('application/octet-stream');
      return reply.send(createReadStream(row.path));
    },
  );
}

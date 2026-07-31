import { db } from './db.ts';

/**
 * Fills in missing locations from time-adjacent located frames.
 *
 * Written for the case where phone pairing drops out mid-trip: if there are
 * located frames before and/or after a gap, where the frames inside it were shot
 * can be estimated reasonably well from their timestamps.
 *
 * Only EXIF and manually assigned locations count as anchors — treating an
 * interpolated result as an anchor would compound error and make repeat runs drift.
 */

export type InterpolateOptions = {
  /** How far from an anchor (in minutes) a frame may still receive a location. */
  maxGapMinutes?: number;
  /** Compute only, write nothing. */
  dryRun?: boolean;
};

export type InterpolateResult = {
  candidates: number;
  filled: number;
  skipped: number;
  maxGapMinutes: number;
  dryRun: boolean;
};

type Row = {
  id: string;
  taken_at: number | null;
  lat: number | null;
  lon: number | null;
  source: string | null;
};

export function interpolateMissingLocations(options: InterpolateOptions = {}): InterpolateResult {
  const maxGapMinutes = Math.max(1, options.maxGapMinutes ?? 30);
  const maxGapMs = maxGapMinutes * 60_000;
  const dryRun = options.dryRun === true;

  const rows = db
    .prepare(
      `SELECT p.id,
              p.taken_at,
              COALESCE(g.lat, p.gps_lat) AS lat,
              COALESCE(g.lon, p.gps_lon) AS lon,
              g.source
       FROM photos p
       LEFT JOIN user_geo g ON g.id = p.id
       WHERE p.taken_at IS NOT NULL
       ORDER BY p.taken_at ASC`,
    )
    .all() as Row[];

  const isAnchor = (row: Row) => row.lat !== null && row.lon !== null && row.source !== 'interpolated';

  // Precompute the nearest anchor on each side for every index: O(n).
  const prevAnchor: (number | null)[] = new Array(rows.length).fill(null);
  const nextAnchor: (number | null)[] = new Array(rows.length).fill(null);

  let last: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    prevAnchor[i] = last;
    if (isAnchor(rows[i])) last = i;
  }
  last = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    nextAnchor[i] = last;
    if (isAnchor(rows[i])) last = i;
  }

  const upsert = db.prepare(
    `INSERT INTO user_geo (id, lat, lon, source, updated_at) VALUES (?, ?, ?, 'interpolated', ?)
     ON CONFLICT(id) DO UPDATE SET lat = excluded.lat, lon = excluded.lon,
       source = excluded.source, updated_at = excluded.updated_at`,
  );

  let candidates = 0;
  let filled = 0;
  const now = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Frames with EXIF or a manual assignment are left alone. Previously
    // interpolated ones stay candidates so a different gap can be re-applied.
    if (row.lat !== null && row.source !== 'interpolated') continue;
    candidates++;

    const t = row.taken_at as number;
    const p = prevAnchor[i] === null ? null : rows[prevAnchor[i] as number];
    const n = nextAnchor[i] === null ? null : rows[nextAnchor[i] as number];

    const beforeGap = p ? t - (p.taken_at as number) : Infinity;
    const afterGap = n ? (n.taken_at as number) - t : Infinity;

    let lat: number | null = null;
    let lon: number | null = null;

    if (p && n && beforeGap <= maxGapMs && afterGap <= maxGapMs) {
      // Between two anchors: linear interpolation weighted by time.
      const span = beforeGap + afterGap;
      const ratio = span === 0 ? 0 : beforeGap / span;
      lat = (p.lat as number) + ((n.lat as number) - (p.lat as number)) * ratio;
      lon = (p.lon as number) + ((n.lon as number) - (p.lon as number)) * ratio;
    } else if (p && beforeGap <= maxGapMs) {
      lat = p.lat;
      lon = p.lon;
    } else if (n && afterGap <= maxGapMs) {
      lat = n.lat;
      lon = n.lon;
    }

    if (lat === null || lon === null) continue;
    if (!dryRun) upsert.run(row.id, lat, lon, now);
    filled++;
  }

  return { candidates, filled, skipped: candidates - filled, maxGapMinutes, dryRun };
}

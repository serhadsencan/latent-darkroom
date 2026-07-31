/**
 * Place search backed by Nominatim (OpenStreetMap's geocoder).
 *
 * Proxied through our own server rather than called from the browser for three
 * reasons: Nominatim's usage policy requires a User-Agent identifying the app
 * (browsers refuse to set it), it caps callers at 1 request/second, and it asks
 * that results be cached. All three are enforced here.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'latent-darkroom/0.1 (local photo library; personal use)';

/** Nominatim's stated limit is 1 req/s; a little headroom keeps us clearly inside it. */
const MIN_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 8000;

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

export type Place = {
  /** Full display name, e.g. "Eminönü, Fatih, İstanbul, Türkiye". */
  label: string;
  /** Shortest useful name, for the primary line of a result row. */
  name: string;
  lat: number;
  lon: number;
  /** Suggested map span, so selecting a city zooms differently than a cafe. */
  bbox: [number, number, number, number] | null;
};

const cache = new Map<string, { at: number; places: Place[] }>();

/** Upstream calls are serialised through this promise chain to honour the rate limit. */
let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCallAt = Date.now();
    return task();
  });
  // Keep the chain alive even when a task rejects.
  queue = run.catch(() => {});
  return run;
}

function readCache(key: string): Place[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.places;
}

function writeCache(key: string, places: Place[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Cheap eviction: drop the oldest inserted key.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), places });
}

type NominatimResult = {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: string[];
};

function toPlace(raw: NominatimResult): Place | null {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const label = raw.display_name ?? raw.name ?? `${lat}, ${lon}`;
  // Nominatim's `name` is often empty; fall back to the first display_name segment.
  const name = raw.name?.trim() || label.split(',')[0].trim();

  let bbox: Place['bbox'] = null;
  if (raw.boundingbox?.length === 4) {
    // Nominatim order is [south, north, west, east].
    const [south, north, west, east] = raw.boundingbox.map(Number);
    if ([south, north, west, east].every(Number.isFinite)) bbox = [south, north, west, east];
  }

  return { label, name, lat, lon, bbox };
}

export async function searchPlaces(query: string, limit = 8): Promise<Place[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const key = `${trimmed.toLowerCase()}|${limit}`;
  const cached = readCache(key);
  if (cached) return cached;

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('addressdetails', '0');

  const places = await schedule(async () => {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`nominatim ${response.status}`);

    const raw = (await response.json()) as NominatimResult[];
    return raw.map(toPlace).filter((p): p is Place => p !== null);
  });

  writeCache(key, places);
  return places;
}

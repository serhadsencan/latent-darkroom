export type Photo = {
  id: string;
  rel: string;
  dir: string;
  name: string;
  ext: string;
  kind: 'image' | 'raw';
  size: number;
  mtime: number;
  width: number | null;
  height: number | null;
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
  /** null → the location comes from the file's own EXIF. */
  gps_source: 'manual' | 'interpolated' | null;
  rating: number;
  flag: 'pick' | 'reject' | null;
};

export type PhotoDetail = Photo & {
  orientation: number | null;
  indexed_at: number;
  exif: Record<string, unknown> | null;
};

export type Facet = { value: string; count: number };
export type Facets = {
  folders: Facet[];
  cameras: Facet[];
  lenses: Facet[];
  films: Facet[];
  years: Facet[];
};

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

export type Status = {
  roots: string[];
  rootsConfigured: boolean;
  total: number;
  raws: number;
  geotagged: number;
  geotaggedExif: number;
  geotaggedManual: number;
  geotaggedInterpolated: number;
  lastScanAt: number | null;
  scan: ScanState;
};

export type MissingGeo = { total: number; folders: Facet[] };

export type InterpolateResult = {
  candidates: number;
  filled: number;
  skipped: number;
  maxGapMinutes: number;
  dryRun: boolean;
};

export type Filters = {
  dir?: string;
  camera?: string;
  lens?: string;
  film?: string;
  year?: string;
  kind?: 'raw' | 'image';
  minRating?: number;
  /** '1' located only, '0' unlocated only. */
  gps?: '1' | '0';
  q?: string;
  sort?: 'taken' | 'added' | 'name' | 'size' | 'rating';
  order?: 'asc' | 'desc';
};

export type GeoFilters = Filters;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function filtersToParams(filters: GeoFilters, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export const api = {
  status: () => json<Status>('/api/status'),
  scanState: () => json<ScanState>('/api/scan'),
  startScan: (force = false) =>
    json<{ started: boolean }>('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    }),
  facets: () => json<Facets>('/api/facets'),
  photos: (filters: GeoFilters, limit = 2000, offset = 0) =>
    json<{ total: number; limit: number; offset: number; photos: Photo[] }>(
      `/api/photos?${filtersToParams(filters, { limit, offset })}`,
    ),
  photo: (id: string) => json<PhotoDetail>(`/api/photos/${id}`),
  /** Moves the files to the macOS Trash and drops them from the index. */
  trash: (ids: string[]) =>
    json<{ trashed: number; failedCount: number; failed: Record<string, string> }>('/api/photos/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }),

  setMeta: (id: string, body: { rating?: number; flag?: 'pick' | 'reject' | null }) =>
    json<{ id: string; rating: number; flag: string | null }>(`/api/photos/${id}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

export const geo = {
  missing: () => json<MissingGeo>('/api/geo/missing'),

  set: (id: string, lat: number | null, lon: number | null) =>
    json<unknown>(`/api/photos/${id}/geo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    }),

  /** Assign one point to every unlocated photo matching the filter. */
  bulk: (filters: GeoFilters, lat: number, lon: number) =>
    json<{ assigned: number }>('/api/geo/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...filters, lat, lon, onlyMissing: true }),
    }),

  /** Assign to frames picked one by one in selection mode. */
  bulkIds: (ids: string[], lat: number, lon: number, onlyMissing = true) =>
    json<{ assigned: number }>('/api/geo/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, lat, lon, onlyMissing }),
    }),

  interpolate: (maxGapMinutes: number, dryRun = false) =>
    json<InterpolateResult>('/api/geo/interpolate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxGapMinutes, dryRun }),
    }),

  clear: (source?: 'manual' | 'interpolated') =>
    json<{ removed: number }>(`/api/geo${source ? `?source=${source}` : ''}`, { method: 'DELETE' }),
};

export const thumbUrl = (id: string, w: number) => `/api/thumb/${id}?w=${w}`;
export const previewUrl = (id: string) => `/api/preview/${id}`;
export const downloadUrl = (id: string) => `/api/original/${id}?download=1`;

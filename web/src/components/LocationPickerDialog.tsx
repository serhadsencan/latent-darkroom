import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle, MapPin, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { geo, type Photo, thumbUrl } from '../api.ts';
import { TILE_ATTRIBUTION, TILE_URLS } from '../lib/basemap.ts';
import { useTheme } from '../lib/useTheme.ts';

type Picked = { lat: number; lon: number; label?: string };

type Props = {
  /** Photos to receive the location. Empty means the dialog is closed. */
  ids: string[];
  /** Loaded Photo objects for the thumbnail strip; may be a subset of `ids`. */
  preview: Photo[];
  onClose: () => void;
  onDone: () => void;
};

/**
 * Map picker for assigning a location to a set of photos.
 *
 * Leaflet lives here as well as on the map page, so this component is lazy-loaded
 * by its caller — the gallery bundle must not pull Leaflet in just to render a
 * toolbar button.
 */
export default function LocationPickerDialog({ ids, preview, onClose, onDone }: Props) {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [picked, setPicked] = useState<Picked | null>(null);
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [resultsOpen, setResultsOpen] = useState(false);

  // Debounce so typing does not hammer the geocoder (Nominatim allows 1 req/s).
  useEffect(() => {
    const timer = setTimeout(() => setQuery(term.trim()), 400);
    return () => clearTimeout(timer);
  }, [term]);

  // Anything that looks like a link or a coordinate pair is treated as a paste
  // rather than search text — that is how a result found in Google Maps gets here.
  const isPaste = /^https?:\/\//i.test(query) || /^-?\d{1,3}(?:\.\d+)?\s*[, ]\s*-?\d{1,3}(?:\.\d+)?$/.test(query);

  const { data: places, isFetching, isError } = useQuery({
    queryKey: ['geocode', query],
    queryFn: () => geo.searchPlaces(query),
    enabled: !isPaste && query.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const {
    data: pasted,
    isFetching: resolving,
    isError: pasteFailed,
  } = useQuery({
    queryKey: ['resolve', query],
    queryFn: () => geo.resolvePasted(query),
    enabled: isPaste && query.length >= 3,
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { center: [39, 35], zoom: 4, zoomControl: true });
    tileLayerRef.current = L.tileLayer(TILE_URLS[theme], {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    map.on('click', (event) => setPicked({ lat: event.latlng.lat, lon: event.latlng.lng }));

    // The dialog animates in, so the map is measured before it has its final size.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // theme is read once at creation; a separate effect keeps it in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tileLayerRef.current?.setUrl(TILE_URLS[theme]);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!picked) return;

    markerRef.current = L.marker([picked.lat, picked.lon], {
      icon: L.divIcon({ className: 'ld-pick', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
    }).addTo(map);
  }, [picked]);

  // A paste has one obvious destination, so jump straight there instead of making
  // the user click a single-item result list.
  const jumpedTo = useRef<string>('');
  useEffect(() => {
    if (!pasted) return;
    const key = `${pasted.lat},${pasted.lon}`;
    if (jumpedTo.current === key) return;
    jumpedTo.current = key;

    setPicked({ lat: pasted.lat, lon: pasted.lon, label: pasted.label });
    setResultsOpen(false);
    mapRef.current?.setView([pasted.lat, pasted.lon], 15);
  }, [pasted]);

  const assign = useMutation({
    mutationFn: () => {
      if (!picked) throw new Error('no point picked');
      // onlyMissing false: the user selected these frames deliberately, so an
      // existing location is meant to be corrected rather than preserved.
      return geo.bulkIds(ids, picked.lat, picked.lon, false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['geo-missing'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      onDone();
      onClose();
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || assign.isPending) return;
      event.stopPropagation();
      // Escape closes the result list first, the dialog second.
      if (resultsOpen) setResultsOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, assign.isPending, resultsOpen]);

  if (ids.length === 0) return null;

  const choosePlace = (place: { lat: number; lon: number; label: string; bbox: [number, number, number, number] | null }) => {
    setPicked({ lat: place.lat, lon: place.lon, label: place.label });
    setResultsOpen(false);
    setTerm(place.label.split(',')[0]);

    const map = mapRef.current;
    if (!map) return;
    // A city gets its bounding box, a shop gets a close zoom.
    if (place.bbox) {
      const [south, north, west, east] = place.bbox;
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { maxZoom: 16, padding: [24, 24] },
      );
    } else {
      map.setView([place.lat, place.lon], 15);
    }
  };

  return (
    <div className="modal modal-open z-[900]">
      <div className="modal-box flex h-[80vh] max-h-[720px] w-[min(92vw,860px)] max-w-none flex-col gap-3 border border-base-300 p-4">
        <div className="flex items-center gap-2">
          <MapPin size={17} className="text-primary" />
          <h3 className="text-[15px] font-medium">
            Set location for {ids.length} {ids.length === 1 ? 'photo' : 'photos'}
          </h3>
          <button onClick={onClose} aria-label="Close" className="btn btn-square btn-sm btn-ghost ml-auto">
            <X size={16} />
          </button>
        </div>

        {/* Search — results overlay the map so the map keeps its full height. */}
        <div className="relative z-[1000]">
          <label className="input input-sm w-full gap-2 bg-base-100">
            <Search size={15} strokeWidth={1.75} className="opacity-50" />
            <input
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setResultsOpen(true);
              }}
              onFocus={() => setResultsOpen(true)}
              placeholder="Search a place, or paste coordinates / a Google Maps link"
              className="grow"
              autoFocus
            />
            {(isFetching || resolving) && <span className="loading loading-spinner loading-xs opacity-60" />}
            {term && !isFetching && !resolving && (
              <button
                onClick={() => {
                  setTerm('');
                  setResultsOpen(false);
                }}
                aria-label="Clear search"
                className="opacity-50 hover:opacity-100"
              >
                <X size={14} />
              </button>
            )}
          </label>

          {isPaste && (pasteFailed || (pasted === null && !resolving)) && (
            <div className="absolute top-full right-0 left-0 z-[1000] mt-1 rounded-box border border-base-300 bg-base-200 px-3 py-2 text-[12px] text-warning shadow-lg">
              Could not read a location from that. Paste coordinates like{' '}
              <code className="rounded bg-base-300 px-1">36.835, 28.642</code> or a Google Maps link.
            </div>
          )}

          {resultsOpen && !isPaste && query.length >= 2 && (
            <ul className="menu absolute top-full right-0 left-0 z-[1000] mt-1 max-h-64 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-200 p-1 shadow-lg">
              {isError && (
                <li className="px-3 py-2 text-[12px] text-warning">
                  Place search is unavailable right now — click the map instead.
                </li>
              )}
              {!isError && places?.length === 0 && !isFetching && (
                <li className="px-3 py-2 text-[12px] text-base-content/55">No matches.</li>
              )}
              {places?.map((place) => (
                <li key={`${place.lat},${place.lon},${place.label}`}>
                  <button onClick={() => choosePlace(place)} className="flex flex-col items-start gap-0 py-1.5">
                    <span className="text-[13px]">{place.name}</span>
                    <span className="truncate text-[11px] opacity-55">{place.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-box border border-base-300" />

        <div className="flex items-center gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {preview.slice(0, 5).map((photo) => (
              <img key={photo.id} src={thumbUrl(photo.id, 320)} alt="" className="h-9 w-9 rounded object-cover" />
            ))}
            {ids.length > 5 && (
              <span className="tabular flex h-9 w-9 items-center justify-center rounded bg-base-300 text-[11px]">
                +{ids.length - 5}
              </span>
            )}
          </div>

          <div className="tabular ml-auto min-w-0 text-right text-[11px] text-base-content/60">
            {picked ? (
              <>
                {picked.label && <div className="truncate">{picked.label}</div>}
                <div>
                  {picked.lat.toFixed(5)}, {picked.lon.toFixed(5)}
                </div>
              </>
            ) : (
              <span>Search for a place or click the map</span>
            )}
          </div>

          <button onClick={onClose} disabled={assign.isPending} className="btn btn-sm btn-ghost">
            cancel
          </button>
          <button
            onClick={() => assign.mutate()}
            disabled={!picked || assign.isPending}
            className="btn btn-sm btn-primary"
          >
            {assign.isPending && <span className="loading loading-spinner loading-xs" />}
            {assign.isPending ? 'assigning…' : 'set location'}
          </button>
        </div>

        {assign.isError && (
          <div role="alert" className="alert alert-error py-2 text-[11px]">
            <AlertTriangle size={15} />
            <span>{String(assign.error)}</span>
          </div>
        )}
      </div>

      <button className="modal-backdrop" onClick={() => !assign.isPending && onClose()} aria-label="Close" />
    </div>
  );
}

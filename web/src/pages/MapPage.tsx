import { keepPreviousData, useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { Crosshair, Maximize, MapPin, MapPinOff, MousePointerClick, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Photo, thumbUrl } from '../api.ts';
import GeoAssignPanel from '../components/GeoAssignPanel.tsx';
import Lightbox from '../components/Lightbox.tsx';
import { formatCount, formatDay } from '../lib/format.ts';
import { useTheme } from '../lib/useTheme.ts';
import { useStore } from '../store.ts';

// Free raster basemap, per theme. This is the only place to change it.
const TILE_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
} as const;
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export default function MapPage() {
  const filters = useStore((s) => s.filters);
  const setActive = useStore((s) => s.setActive);
  const selectionCount = useStore((s) => s.selection.size);

  const theme = useTheme();
  // The map is created once; read the theme at creation time from a ref.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const pickMarkerRef = useRef<L.Marker | null>(null);
  // Avoid re-fitting the same point set and clobbering the user's zoom.
  const fittedSignature = useRef<string>('');

  const [assignMode, setAssignMode] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  // The Leaflet click handler binds once; it reads the current mode from a ref.
  const assignModeRef = useRef(assignMode);
  assignModeRef.current = assignMode;

  const { data: status } = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 5_000 });

  const { data } = useQuery({
    queryKey: ['photos', 'geo', filters],
    queryFn: () => api.photos({ ...filters, gps: '1' }, 5000, 0),
    placeholderData: keepPreviousData,
  });

  const photos = useMemo(
    () => (data?.photos ?? []).filter((p) => p.gps_lat != null && p.gps_lon != null),
    [data],
  );

  // The map is built once; only the marker layer is rebuilt as photos change.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.0, 35.0],
      zoom: 5,
      zoomControl: true,
      worldCopyJump: true,
    });
    tileLayerRef.current = L.tileLayer(TILE_URLS[themeRef.current], {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    // Leaflet does not track its container size; without this the map keeps its
    // old dimensions when the panel opens or the window resizes.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    map.on('click', (event) => {
      if (!assignModeRef.current) return;
      setPicked({ lat: event.latlng.lat, lon: event.latlng.lng });
    });

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      fittedSignature.current = '';
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    clusterRef.current?.remove();
    if (photos.length === 0) {
      clusterRef.current = null;
      return;
    }

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 48,
      showCoverageOnHover: false,
      iconCreateFunction: (group) => {
        const count = group.getChildCount();
        return L.divIcon({
          html: `<span>${count}</span>`,
          className: 'ld-cluster',
          iconSize: [38, 38],
        });
      },
    });

    for (const photo of photos) {
      // The border shows where the location came from: EXIF is exact, assignments are estimates.
      const sourceClass = photo.gps_source ? ` ld-pin--${photo.gps_source}` : '';
      const sourceLabel =
        photo.gps_source === 'manual'
          ? ' (assigned manually)'
          : photo.gps_source === 'interpolated'
            ? ' (derived from time)'
            : '';

      const marker = L.marker([photo.gps_lat as number, photo.gps_lon as number], {
        icon: L.divIcon({
          html: `<img src="${thumbUrl(photo.id, 320)}" alt="" loading="lazy" />`,
          className: `ld-pin${sourceClass}`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
        title: `${photo.name} — ${formatDay(photo.taken_at)}${sourceLabel}`,
      });
      marker.on('click', () => setActive(photo.id));
      cluster.addLayer(marker);
    }

    cluster.addTo(map);
    clusterRef.current = cluster;

    // Only refit when the point set actually changed.
    const signature = photos.map((p) => p.id).join(',');
    if (signature !== fittedSignature.current) {
      fittedSignature.current = signature;
      map.fitBounds(cluster.getBounds(), { padding: [48, 48], maxZoom: 15 });
    }
  }, [photos, setActive]);

  // Swap the basemap on theme change — URL only, no map rebuild.
  useEffect(() => {
    tileLayerRef.current?.setUrl(TILE_URLS[theme]);
  }, [theme]);

  // Show the picked point; remove it when assign mode closes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    pickMarkerRef.current?.remove();
    pickMarkerRef.current = null;
    if (!picked) return;

    pickMarkerRef.current = L.marker([picked.lat, picked.lon], {
      icon: L.divIcon({ className: 'ld-pick', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
    }).addTo(map);
  }, [picked]);

  useEffect(() => {
    if (!assignMode) setPicked(null);
  }, [assignMode]);

  const fitAll = () => {
    const cluster = clusterRef.current;
    if (cluster && mapRef.current) mapRef.current.fitBounds(cluster.getBounds(), { padding: [48, 48], maxZoom: 15 });
  };

  const noneGeotagged = status !== undefined && status.geotagged === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* min-w-0 + overflow-hidden so the assign panel taking 288px cannot push
          controls off the edge. */}
      <header className="@container flex min-w-0 shrink-0 items-center gap-3 overflow-hidden border-b border-base-300 bg-base-200 px-3 py-2">
        <span className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
          <MapPin size={15} strokeWidth={1.75} className="text-primary" />
          Map
        </span>
        <span className="tabular hidden shrink-0 text-xs whitespace-nowrap text-base-content/55 @sm:inline">
          {formatCount(photos.length)} located
          {status && status.total > 0 && (
            <span className="text-base-content/35"> / {formatCount(status.total)}</span>
          )}
        </span>
        <FilterChips />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {selectionCount > 0 && (
            <span className="tabular badge badge-sm badge-primary badge-outline whitespace-nowrap">
              {selectionCount} selected
            </span>
          )}

          <div className="tooltip tooltip-bottom" data-tip="Assign locations to unlocated frames">
            <button
              onClick={() => setAssignMode((v) => !v)}
              aria-pressed={assignMode}
              className={`btn btn-sm gap-1.5 ${assignMode ? 'btn-primary' : 'btn-ghost'}`}
            >
              <Crosshair size={15} />
              <span className="hidden @md:inline">assign location</span>
            </button>
          </div>

          <div className="tooltip tooltip-bottom tooltip-left" data-tip="Fit all points">
            <button
              onClick={fitAll}
              disabled={photos.length === 0}
              aria-label="Fit all"
              className="btn btn-square btn-sm btn-ghost"
            >
              <Maximize size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The state class lives on the wrapper. The map div's className must stay
            constant: Leaflet adds its own classes (leaflet-container etc.) there and a
            React re-render would wipe them, taking every map style with them. */}
        <div className={`relative min-h-0 flex-1 ${assignMode ? 'ld-assigning' : ''}`}>
          <div ref={containerRef} className="h-full w-full" />
          {noneGeotagged && !assignMode && <NoGeotagsOverlay />}
          {assignMode && !picked && (
            <div className="pointer-events-none absolute top-3 left-1/2 z-[500] flex -translate-x-1/2 items-center gap-2 rounded-box border border-primary/40 bg-base-100/95 px-3 py-1.5 text-[12px] text-primary shadow">
              <MousePointerClick size={14} />
              Click the map to assign a location
            </div>
          )}
        </div>
        {assignMode && <GeoAssignPanel picked={picked} onClearPicked={() => setPicked(null)} />}
      </div>

      <Lightbox photos={photos} />
    </div>
  );
}

/** Filters carried over from the gallery apply here too — show which are active. */
function FilterChips() {
  const filters = useStore((s) => s.filters);
  const resetFilters = useStore((s) => s.resetFilters);

  const chips = (['year', 'dir', 'camera', 'lens', 'film', 'kind', 'q'] as const)
    .map((key) => ({ key, value: filters[key] }))
    .filter((chip): chip is { key: typeof chip.key; value: string } => Boolean(chip.value));

  if (chips.length === 0) return null;

  return (
    <span className="flex items-center gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className="badge badge-sm badge-ghost">
          {chip.value}
        </span>
      ))}
      <button onClick={resetFilters} aria-label="Clear filters" className="btn btn-square btn-xs btn-ghost">
        <X size={13} />
      </button>
    </span>
  );
}

function NoGeotagsOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
      <div className="card pointer-events-auto max-w-md border border-base-300 bg-base-200 shadow-lg">
        <div className="card-body items-center gap-2 p-5 text-center">
          <MapPinOff size={22} className="text-base-content/40" />
          <h2 className="card-title text-[15px]">No photos have location data</h2>
          <p className="text-[13px] leading-relaxed text-base-content/70">
            No file in the library carries GPS EXIF. Most cameras do not record location; on Fuji bodies it
            is written once the camera is paired with <em>Fujifilm XApp</em> on your phone.
          </p>
        </div>
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crosshair, Timer, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { api, geo, type GeoFilters } from '../api.ts';
import { useStore } from '../store.ts';

/** Gap options for auto-fill. Wide, because Fuji pairing can drop out for hours. */
const GAP_OPTIONS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 360, label: '6 hours' },
  { minutes: 1440, label: '1 day' },
  { minutes: 2880, label: '2 days' },
];

/** The target is either the gallery selection or an entire folder. */
const SELECTION_TARGET = '@selection';

type Props = {
  /** The point picked on the map; null means the user has not clicked yet. */
  picked: { lat: number; lon: number } | null;
  onClearPicked: () => void;
};

export default function GeoAssignPanel({ picked, onClearPicked }: Props) {
  const queryClient = useQueryClient();
  const selection = useStore((s) => s.selection);
  const clearSelection = useStore((s) => s.clearSelection);
  const [gap, setGap] = useState(2880);
  const [note, setNote] = useState<string | null>(null);
  // Default to the selection when there is one; the user can switch to a folder.
  const [target, setTarget] = useState<string>(selection.size > 0 ? SELECTION_TARGET : '');

  const { data: missing } = useQuery({ queryKey: ['geo-missing'], queryFn: geo.missing });
  const { data: status } = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 5_000 });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['photos'] });
    queryClient.invalidateQueries({ queryKey: ['geo-missing'] });
    queryClient.invalidateQueries({ queryKey: ['status'] });
  };

  const targetCount =
    target === SELECTION_TARGET
      ? selection.size
      : target
        ? (missing?.folders.find((f) => f.value === target)?.count ?? 0)
        : (missing?.total ?? 0);

  const assign = useMutation({
    mutationFn: () => {
      if (!picked) throw new Error('no point picked');
      if (target === SELECTION_TARGET) {
        // In selection mode an already-located frame may be picked on purpose; overwrite.
        return geo.bulkIds([...selection], picked.lat, picked.lon, false);
      }
      const filters: GeoFilters = target ? { dir: target } : {};
      return geo.bulk(filters, picked.lat, picked.lon);
    },
    onSuccess: (result) => {
      setNote(`Location assigned to ${result.assigned} photos.`);
      onClearPicked();
      if (target === SELECTION_TARGET) clearSelection();
      refresh();
    },
  });

  const preview = useMutation({
    mutationFn: () => geo.interpolate(gap, true),
    onSuccess: (r) => setNote(`This gap would fill ${r.filled} photos (${r.skipped} have no anchor).`),
  });

  const fill = useMutation({
    mutationFn: () => geo.interpolate(gap, false),
    onSuccess: (r) => {
      setNote(`Filled ${r.filled} photos from timestamps.`);
      refresh();
    },
  });

  const undo = useMutation({
    mutationFn: (source?: 'manual' | 'interpolated') => geo.clear(source),
    onSuccess: (r) => {
      setNote(`Reverted ${r.removed} assignments.`);
      refresh();
    },
  });

  return (
    <div className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-l border-base-300 bg-base-200">
      <div className="border-b border-base-300 px-3 py-3">
        <div className="text-[13px] font-medium">Assign location</div>
        {status && (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="tabular badge badge-xs badge-ghost">{status.geotaggedExif} EXIF</span>
            <span className="tabular badge badge-xs badge-secondary badge-outline">
              {status.geotaggedManual} manual
            </span>
            <span className="tabular badge badge-xs badge-ghost">{status.geotaggedInterpolated} interpolated</span>
          </div>
        )}
        <div className="tabular mt-2 text-[11px] text-base-content/55">
          <span className="text-base-content">{missing?.total ?? 0}</span> photos have no location
        </div>
      </div>

      {/* 1) Manual assignment from the map */}
      <section className="border-b border-base-300 px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-medium tracking-wider text-base-content/55 uppercase">
          <Crosshair size={13} strokeWidth={1.75} />
          Assign from map
        </div>

        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Target"
          className="select select-sm mb-2 w-full bg-base-100"
        >
          {selection.size > 0 && <option value={SELECTION_TARGET}>Selected in gallery ({selection.size})</option>}
          <option value="">Everything unlocated ({missing?.total ?? 0})</option>
          {missing?.folders.map((folder) => (
            <option key={folder.value} value={folder.value}>
              {folder.value || '(root)'} ({folder.count})
            </option>
          ))}
        </select>

        {picked ? (
          <>
            <div className="tabular mb-2 rounded bg-base-100 px-2 py-1.5 text-[11px]">
              {picked.lat.toFixed(5)}, {picked.lon.toFixed(5)}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => assign.mutate()}
                disabled={assign.isPending || targetCount === 0}
                className="btn btn-sm btn-primary flex-1"
              >
                {assign.isPending && <span className="loading loading-spinner loading-xs" />}
                {assign.isPending ? 'assigning…' : `assign to ${targetCount}`}
              </button>
              <button onClick={onClearPicked} className="btn btn-sm btn-ghost">
                cancel
              </button>
            </div>
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-base-content/55">
            Click a point on the map — it is applied to every unlocated photo in the chosen target.
          </p>
        )}
      </section>

      {/* 2) Automatic fill from timestamps */}
      <section className="border-b border-base-300 px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-medium tracking-wider text-base-content/55 uppercase">
          <Timer size={13} strokeWidth={1.75} />
          Derive from time
        </div>
        <p className="mb-2 text-[11px] leading-relaxed text-base-content/55">
          Estimates an unlocated frame from the nearest located frames in time. A wider gap covers more
          frames but is less accurate.
        </p>

        <select
          value={gap}
          onChange={(e) => setGap(Number(e.target.value))}
          aria-label="Maximum gap"
          className="select select-sm mb-2 w-full bg-base-100"
        >
          {GAP_OPTIONS.map((option) => (
            <option key={option.minutes} value={option.minutes}>
              within {option.label}
            </option>
          ))}
        </select>

        <div className="flex gap-1.5">
          <button onClick={() => preview.mutate()} disabled={preview.isPending} className="btn btn-sm btn-ghost flex-1">
            preview
          </button>
          <button onClick={() => fill.mutate()} disabled={fill.isPending} className="btn btn-sm btn-primary flex-1">
            {fill.isPending && <span className="loading loading-spinner loading-xs" />}
            fill
          </button>
        </div>
      </section>

      {/* 3) Undo — everything is reversible because originals are untouched */}
      <section className="px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-medium tracking-wider text-base-content/55 uppercase">
          <Undo2 size={13} strokeWidth={1.75} />
          Undo
        </div>
        <div className="flex flex-col gap-1.5">
          <button onClick={() => undo.mutate('interpolated')} className="btn btn-xs btn-ghost justify-start">
            clear interpolated
          </button>
          <button onClick={() => undo.mutate('manual')} className="btn btn-xs btn-ghost justify-start">
            clear manual
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-base-content/40">
          Assignments live only in the app's database; photo files are never touched.
        </p>
      </section>

      {note && (
        <div role="alert" className="alert mx-3 mb-3 py-2 text-[11px]">
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}

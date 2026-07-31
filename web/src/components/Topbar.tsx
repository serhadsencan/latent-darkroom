import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  SquareCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type Filters, type Photo } from '../api.ts';
import { formatCount } from '../lib/format.ts';
import { useStore } from '../store.ts';
import TrashDialog from './TrashDialog.tsx';

const SORT_LABELS: Record<NonNullable<Filters['sort']>, string> = {
  taken: 'Date taken',
  added: 'Date added',
  name: 'File name',
  size: 'File size',
  rating: 'Rating',
};

export default function Topbar({ total, photos }: { total: number; photos: Photo[] }) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const rowHeight = useStore((s) => s.rowHeight);
  const setRowHeight = useStore((s) => s.setRowHeight);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const queryClient = useQueryClient();

  const [term, setTerm] = useState(filters.q ?? '');
  const searchRef = useRef<HTMLInputElement>(null);
  // The last value we pushed, so an external change can be told apart.
  const lastPushed = useRef(filters.q ?? '');

  // Avoid firing a query on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      lastPushed.current = term;
      setFilter('q', term || undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [term, setFilter]);

  // Sync the input when the filter changes from elsewhere (e.g. "clear").
  const q = filters.q ?? '';
  useEffect(() => {
    if (q !== lastPushed.current) {
      lastPushed.current = q;
      setTerm(q);
    }
  }, [q]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data: scan } = useQuery({
    queryKey: ['scan'],
    queryFn: api.scanState,
    // Poll live while a scan runs, then stop.
    refetchInterval: (query) => (query.state.data?.running ? 500 : false),
  });

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !scan?.running) {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['facets'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    }
    wasRunning.current = scan?.running ?? false;
  }, [scan?.running, queryClient]);

  const startScan = useMutation({
    mutationFn: () => api.startScan(false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scan'] }),
  });

  const scanned = scan ? scan.processed + scan.skipped + scan.failed : 0;
  const ascending = filters.order === 'asc';

  return (
    // min-w-0 + overflow-hidden: without them a single oversized child pushes the
    // whole document into horizontal scroll and controls fall off the right edge.
    <header className="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-base-300 bg-base-200 px-3 py-2">
      <div className="tooltip tooltip-bottom shrink-0" data-tip={sidebarOpen ? 'Hide filters' : 'Show filters'}>
        <button
          onClick={toggleSidebar}
          aria-label="Toggle filters"
          aria-pressed={sidebarOpen}
          className="btn btn-square btn-sm btn-ghost"
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>

      {/* Shrinks on narrow windows but never below readable. */}
      <label className="input input-sm w-72 min-w-32 shrink gap-2 bg-base-100">
        <Search size={15} strokeWidth={1.75} className="opacity-50" />
        <input
          ref={searchRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search files, folders, bodies, lenses"
          className="grow"
        />
        {term ? (
          <button onClick={() => setTerm('')} aria-label="Clear search" className="opacity-50 hover:opacity-100">
            <X size={14} />
          </button>
        ) : (
          <kbd className="kbd kbd-xs">/</kbd>
        )}
      </label>

      <select
        value={filters.sort ?? 'taken'}
        onChange={(e) => setFilter('sort', e.target.value as Filters['sort'])}
        className="select select-sm hidden w-36 shrink-0 bg-base-100 @lg:flex"
        aria-label="Sort by"
      >
        {Object.entries(SORT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <div className="tooltip tooltip-bottom hidden shrink-0 @lg:block" data-tip={ascending ? 'Ascending' : 'Descending'}>
        <button
          onClick={() => setFilter('order', ascending ? 'desc' : 'asc')}
          aria-label="Sort direction"
          className="btn btn-square btn-sm btn-ghost"
        >
          {ascending ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        </button>
      </div>

      {/* Secondary control: first to go when space runs out. */}
      <div className="tooltip tooltip-bottom hidden shrink-0 items-center gap-2 pl-1 @2xl:flex" data-tip="Thumbnail density">
        <LayoutGrid size={15} strokeWidth={1.75} className="opacity-50" />
        <input
          type="range"
          min={120}
          max={480}
          step={20}
          value={rowHeight}
          onChange={(e) => setRowHeight(Number(e.target.value))}
          aria-label="Thumbnail density"
          className="range range-xs range-primary w-24"
        />
      </div>

      <SelectionControls photos={photos} />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {scan?.running ? (
          <span className="tabular flex items-center gap-2 text-xs whitespace-nowrap text-primary">
            <span className="loading loading-spinner loading-xs" />
            {scanned}/{scan.found}
          </span>
        ) : (
          <span className="tabular hidden text-xs whitespace-nowrap text-base-content/55 @sm:inline">
            {formatCount(total)} photos
          </span>
        )}

        <div className="tooltip tooltip-bottom tooltip-left" data-tip="Rescan the library">
          <button
            onClick={() => startScan.mutate()}
            disabled={scan?.running}
            aria-label="Rescan"
            className="btn btn-square btn-sm btn-ghost"
          >
            <RefreshCw size={16} className={scan?.running ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * Selection mode. The selection lives in the global store so it carries over to
 * the map page: pick in the gallery, assign a location on the map.
 */
function SelectionControls({ photos }: { photos: Photo[] }) {
  const selectionMode = useStore((s) => s.selectionMode);
  const setSelectionMode = useStore((s) => s.setSelectionMode);
  const selection = useStore((s) => s.selection);
  const selectAll = useStore((s) => s.selectAll);
  const clearSelection = useStore((s) => s.clearSelection);
  const [trashOpen, setTrashOpen] = useState(false);

  const selectedIds = [...selection];
  // The selection may span other filters; only loaded photos can be previewed.
  const selectedPhotos = photos.filter((p) => selection.has(p.id));

  return (
    <div className="flex shrink-0 items-center gap-2 border-l border-base-300 pl-2">
      <div className="tooltip tooltip-bottom" data-tip="Selection mode — shift for a range">
        <button
          onClick={() => setSelectionMode(!selectionMode)}
          aria-label="Selection mode"
          aria-pressed={selectionMode}
          className={`btn btn-square btn-sm ${selectionMode ? 'btn-primary' : 'btn-ghost'}`}
        >
          <SquareCheck size={16} />
        </button>
      </div>

      {selectionMode && (
        <>
          <span className="tabular badge badge-sm badge-ghost">{selection.size} selected</span>

          <button onClick={() => selectAll(photos.map((p) => p.id))} className="btn btn-xs btn-ghost">
            select listed
          </button>

          {selection.size > 0 && (
            <>
              <div className="tooltip tooltip-bottom" data-tip="Clear selection">
                <button onClick={clearSelection} aria-label="Clear selection" className="btn btn-square btn-xs btn-ghost">
                  <X size={14} />
                </button>
              </div>
              <div className="tooltip tooltip-bottom" data-tip="Move selected to Trash">
                <button
                  onClick={() => setTrashOpen(true)}
                  aria-label="Delete selected"
                  className="btn btn-square btn-xs btn-ghost text-error"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </>
          )}
        </>
      )}

      {trashOpen && (
        <TrashDialog
          ids={selectedIds}
          preview={selectedPhotos}
          onClose={() => setTrashOpen(false)}
          onDone={clearSelection}
        />
      )}
    </div>
  );
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Check,
  Crop,
  Grid3x3,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RectangleVertical,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, grids as gridsApi, type GridSummary, type Photo, thumbUrl } from '../api.ts';
import Lightbox from '../components/Lightbox.tsx';
import { useStore } from '../store.ts';

/**
 * Instagram's profile grid is three columns and fills newest-first, so the top-left
 * tile is the most recent post. Planning a grid means deciding a posting order.
 */
const COLUMNS = 3;

/**
 * Tile shape. Instagram moved profile thumbnails from square to 4:5 in 2025 and the
 * rollout was not uniform, so both are offered rather than guessing.
 */
const SHAPES = {
  '4:5': { label: '4:5', ratio: '4 / 5', Icon: RectangleVertical },
  '1:1': { label: '1:1', ratio: '1 / 1', Icon: Square },
} as const;
type Shape = keyof typeof SHAPES;

const TILE_MIN = 150;
const TILE_GAP = 8;

/** Which grid was last open — a UI preference, so the browser is the right home. */
const ACTIVE_KEY = 'ld:active-grid';

export default function InstagramPage() {
  const selection = useStore((s) => s.selection);
  const setActive = useStore((s) => s.setActive);

  const [shape, setShape] = useState<Shape>('4:5');
  const [cropped, setCropped] = useState(true);
  const [planOpen, setPlanOpen] = useState(true);

  // The picker has its own search, deliberately unconnected to the gallery filters:
  // a grid is planned across the whole library, not inside whatever was last browsed.
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [renaming, setRenaming] = useState<string | null>(null);

  /** Grids live in the database, so they survive browsers and machines. */
  const { data: gridList } = useQuery({ queryKey: ['grids'], queryFn: gridsApi.list });

  // Fall back to the most recently touched grid when the stored one is gone.
  const activeGrid = gridList?.find((g) => g.id === activeId) ?? gridList?.[0];
  useEffect(() => {
    if (activeGrid && activeGrid.id !== activeId) {
      setActiveId(activeGrid.id);
      localStorage.setItem(ACTIVE_KEY, activeGrid.id);
    }
  }, [activeGrid, activeId]);

  const selectGrid = (id: string) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_KEY, id);
  };

  const { data: openGrid } = useQuery({
    queryKey: ['grid', activeGrid?.id],
    queryFn: () => gridsApi.get(activeGrid!.id),
    enabled: Boolean(activeGrid),
    staleTime: Infinity,
  });

  const [plan, setPlan] = useState<Photo[]>([]);
  useEffect(() => {
    setPlan(openGrid?.photos ?? []);
  }, [openGrid]);

  const save = useMutation({
    mutationFn: (ids: string[]) => gridsApi.update(activeGrid!.id, { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grids'] }),
  });

  const createGrid = useMutation({
    mutationFn: () => gridsApi.create(),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ['grids'] });
      selectGrid(id);
      // A fresh grid is called "Untitled"; open the rename box straight away.
      setRenaming(id);
    },
  });

  const renameGrid = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => gridsApi.update(id, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grids'] }),
  });

  const deleteGrid = useMutation({
    mutationFn: (id: string) => gridsApi.remove(id),
    onSuccess: async () => {
      localStorage.removeItem(ACTIVE_KEY);
      setActiveId(null);
      await queryClient.invalidateQueries({ queryKey: ['grids'] });
    },
  });

  /** Every edit writes the whole ordered list; the server is the source of truth. */
  const commit = (next: Photo[]) => {
    if (!activeGrid) return;
    setPlan(next);
    save.mutate(next.map((p) => p.id));
  };

  const { data: candidates } = useQuery({
    queryKey: ['grid-pool', search],
    queryFn: () => api.photos(search ? { q: search } : {}, 2000, 0),
    placeholderData: keepPreviousData,
  });

  const planIds = useMemo(() => new Set(plan.map((p) => p.id)), [plan]);
  const pool = useMemo(
    () => (candidates?.photos ?? []).filter((p) => !planIds.has(p.id)),
    [candidates, planIds],
  );

  const add = (photo: Photo) => commit([...plan, photo]);
  const remove = (id: string) => commit(plan.filter((p) => p.id !== id));
  const addSelection = () => {
    const chosen = (candidates?.photos ?? []).filter((p) => selection.has(p.id) && !planIds.has(p.id));
    if (chosen.length) commit([...plan, ...chosen]);
  };

  const dragFrom = useRef<number | null>(null);
  const moveTo = (to: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === to) return;
    const next = [...plan];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  // The picker is virtualised: the whole library is in play, not a filtered slice.
  const poolRef = useRef<HTMLDivElement>(null);
  const [poolWidth, setPoolWidth] = useState(0);
  useLayoutEffect(() => {
    const el = poolRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setPoolWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const poolColumns = Math.max(1, Math.floor((poolWidth + TILE_GAP) / (TILE_MIN + TILE_GAP)));
  const tileSize = poolColumns > 0 ? (poolWidth - TILE_GAP * (poolColumns - 1)) / poolColumns : TILE_MIN;
  const poolRows = Math.ceil(pool.length / poolColumns);

  const poolVirtualizer = useVirtualizer({
    count: poolRows,
    getScrollElement: () => poolRef.current,
    estimateSize: () => tileSize + TILE_GAP,
    overscan: 3,
  });

  const rows = Math.ceil(plan.length / COLUMNS);
  const ratio = SHAPES[shape].ratio;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <header className="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-base-300 bg-base-200 px-3 py-2">
        <span className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
          <Grid3x3 size={15} strokeWidth={1.75} className="text-primary" />
        </span>

        <GridSwitcher
          grids={gridList ?? []}
          activeId={activeGrid?.id ?? null}
          renaming={renaming}
          onSelect={selectGrid}
          onCreate={() => createGrid.mutate()}
          onStartRename={setRenaming}
          onRename={(id, name) => {
            setRenaming(null);
            if (name.trim()) renameGrid.mutate({ id, name: name.trim() });
          }}
          onDelete={(id) => deleteGrid.mutate(id)}
        />

        <label className="input input-sm w-64 min-w-32 shrink gap-2 bg-base-100">
          <Search size={15} strokeWidth={1.75} className="opacity-50" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search the whole library"
            className="grow"
          />
          {term && (
            <button onClick={() => setTerm('')} aria-label="Clear search" className="opacity-50 hover:opacity-100">
              <X size={14} />
            </button>
          )}
        </label>

        <span className="tabular hidden shrink-0 text-xs whitespace-nowrap text-base-content/55 @lg:inline">
          {plan.length} posts · {rows} {rows === 1 ? 'row' : 'rows'}
          {save.isPending && <span className="text-base-content/35"> · saving…</span>}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {selection.size > 0 && (
            <button onClick={addSelection} className="btn btn-sm btn-ghost gap-1.5">
              <Plus size={14} />
              add {selection.size} selected
            </button>
          )}

          <div className="join">
            {(Object.keys(SHAPES) as Shape[]).map((key) => {
              const { label, Icon } = SHAPES[key];
              return (
                <button
                  key={key}
                  onClick={() => setShape(key)}
                  className={`btn join-item btn-sm gap-1.5 ${shape === key ? 'btn-primary' : 'btn-ghost'}`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>

          <div className="tooltip tooltip-bottom" data-tip={cropped ? 'Showing the crop' : 'Showing the full frame'}>
            <button
              onClick={() => setCropped((v) => !v)}
              aria-pressed={cropped}
              aria-label="Toggle crop"
              className={`btn btn-square btn-sm ${cropped ? 'btn-ghost' : 'btn-primary'}`}
            >
              <Crop size={16} />
            </button>
          </div>

          <div className="tooltip tooltip-bottom" data-tip="Empty the plan">
            <button
              onClick={() => commit([])}
              disabled={plan.length === 0}
              aria-label="Clear plan"
              className="btn btn-square btn-sm btn-ghost"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          <div className="tooltip tooltip-bottom tooltip-left" data-tip={planOpen ? 'Hide preview' : 'Show preview'}>
            <button
              onClick={() => setPlanOpen((v) => !v)}
              aria-label="Toggle preview"
              aria-pressed={planOpen}
              className="btn btn-square btn-sm btn-ghost"
            >
              {planOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The picker gets the room. Choosing is the hard part; the phone preview is
            fixed-width by nature and would only waste the space. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-2 text-[11px] font-medium tracking-wider text-base-content/55 uppercase">
            Pick photos
            <span className="tabular normal-case">{pool.length}</span>
          </div>

          <div ref={poolRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            {pool.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-base-content/55">
                {search ? 'Nothing matches that search.' : 'Every photo is already in the plan.'}
              </p>
            ) : (
              <div style={{ height: poolVirtualizer.getTotalSize(), position: 'relative' }}>
                {poolVirtualizer.getVirtualItems().map((row) => (
                  <div
                    key={row.key}
                    className="absolute top-0 left-0 flex w-full"
                    style={{ gap: TILE_GAP, height: tileSize, transform: `translateY(${row.start}px)` }}
                  >
                    {pool.slice(row.index * poolColumns, row.index * poolColumns + poolColumns).map((photo) => (
                      <button
                        key={photo.id}
                        onClick={() => add(photo)}
                        onDoubleClick={() => setActive(photo.id)}
                        title={`${photo.name} — click to add, double-click to open`}
                        className="group relative overflow-hidden rounded bg-base-200 ring-primary transition-shadow hover:ring-2"
                        style={{ width: tileSize, height: tileSize }}
                      >
                        <img
                          src={thumbUrl(photo.id, 640)}
                          alt={photo.name}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-content">
                            <Plus size={13} strokeWidth={2.5} />
                            add
                          </span>
                        </span>
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-[10px] text-white/85 opacity-0 transition-opacity group-hover:opacity-100">
                          {photo.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {planOpen && (
          <div className="min-h-0 w-[452px] shrink-0 overflow-y-auto border-l border-base-300 bg-base-200 p-4">
            {plan.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="card border border-base-300">
                  <div className="card-body items-center gap-2 text-center">
                    <Grid3x3 size={22} className="text-base-content/40" />
                    <h2 className="card-title text-base">Empty grid</h2>
                    <p className="text-[13px] leading-relaxed text-base-content/70">
                      Click photos on the left to fill it. Drag tiles to set the order you will post in.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* Roughly a phone's width — judge it at the size it will be seen. */
              <div className="mx-auto w-full max-w-[420px]">
                <p className="mb-3 text-center text-[11px] text-base-content/45">
                  Newest first, like the real profile. Drag to reorder, click ✕ to drop.
                </p>

                <div className="grid grid-cols-3 gap-0.5">
                  {plan.map((photo, index) => (
                    <div
                      key={photo.id}
                      draggable
                      onDragStart={() => (dragFrom.current = index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => moveTo(index)}
                      onDoubleClick={() => setActive(photo.id)}
                      title={`${index + 1}. ${photo.name} — double-click to open`}
                      className="group relative w-full overflow-hidden bg-base-300"
                      style={{ aspectRatio: ratio }}
                    >
                      <img
                        src={thumbUrl(photo.id, 640)}
                        alt={photo.name}
                        loading="lazy"
                        decoding="async"
                        className={`h-full w-full ${cropped ? 'object-cover' : 'object-contain'}`}
                      />
                      <span className="tabular pointer-events-none absolute top-1 left-1 rounded bg-black/55 px-1 text-[9px] text-white/85 opacity-0 transition-opacity group-hover:opacity-100">
                        {index + 1}
                      </span>
                      <button
                        onClick={() => remove(photo.id)}
                        aria-label={`Remove ${photo.name}`}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded bg-black/60 text-white/85 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-error hover:text-error-content"
                      >
                        <X size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>

                <p className="mt-4 text-center text-[11px] leading-relaxed text-base-content/45">
                  {cropped
                    ? 'Tiles are centre-cropped, exactly as Instagram does it.'
                    : 'Full frames shown — the letterboxed areas are what Instagram would cut.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Double-clicking a tile opens it here, and the arrows walk the planned order. */}
      <Lightbox photos={plan} />
    </div>
  );
}

type SwitcherProps = {
  grids: GridSummary[];
  activeId: string | null;
  /** Id whose name is being edited, if any. */
  renaming: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onStartRename: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

/** Switch, rename, create and delete saved grids. */
function GridSwitcher({
  grids,
  activeId,
  renaming,
  onSelect,
  onCreate,
  onStartRename,
  onRename,
  onDelete,
}: SwitcherProps) {
  const active = grids.find((g) => g.id === activeId);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Seed the rename box from whichever grid just entered edit mode.
  useEffect(() => {
    if (renaming) setDraft(grids.find((g) => g.id === renaming)?.name ?? '');
  }, [renaming, grids]);

  useEffect(() => setConfirmDelete(false), [activeId]);

  if (renaming && active && renaming === active.id) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(active.id, draft);
            if (e.key === 'Escape') onRename(active.id, '');
          }}
          onBlur={() => onRename(active.id, draft)}
          // Select on focus so typing replaces the placeholder name rather than
          // appending to it — the same behaviour as renaming a file.
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Grid name"
          className="input input-sm w-40 bg-base-100"
          autoFocus
        />
        <button
          onClick={() => onRename(active.id, draft)}
          aria-label="Save name"
          className="btn btn-square btn-sm btn-ghost text-primary"
        >
          <Check size={15} />
        </button>
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <select
        value={activeId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Grid"
        disabled={grids.length === 0}
        className="select select-sm w-44 bg-base-100"
      >
        {grids.length === 0 && <option value="">No grids yet</option>}
        {grids.map((grid) => (
          <option key={grid.id} value={grid.id}>
            {grid.name} ({grid.count})
          </option>
        ))}
      </select>

      <div className="tooltip tooltip-bottom" data-tip="New grid">
        <button onClick={onCreate} aria-label="New grid" className="btn btn-square btn-sm btn-ghost">
          <Plus size={16} />
        </button>
      </div>

      {active && (
        <>
          <div className="tooltip tooltip-bottom" data-tip="Rename">
            <button
              onClick={() => onStartRename(active.id)}
              aria-label="Rename grid"
              className="btn btn-square btn-sm btn-ghost"
            >
              <Pencil size={15} />
            </button>
          </div>

          <div className="tooltip tooltip-bottom" data-tip={confirmDelete ? 'Click again to confirm' : 'Delete grid'}>
            <button
              onClick={() => (confirmDelete ? onDelete(active.id) : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
              aria-label="Delete grid"
              className={`btn btn-square btn-sm ${confirmDelete ? 'btn-error' : 'btn-ghost'}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </>
      )}
    </span>
  );
}

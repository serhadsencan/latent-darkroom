import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, MapPinOff, Star } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Photo, thumbUrl } from '../api.ts';
import { layoutJustified } from '../lib/justified.ts';
import { useStore } from '../store.ts';

const GAP = 6;
const PADDING = 16;

// The server's thumbnail buckets. Asking for an in-between size just snaps anyway.
const THUMB_SIZES = [320, 640, 1280, 2560] as const;

/**
 * The thumbnail size a box needs. The server scales with `fit: inside`, so the
 * long edge is what matters.
 *
 * Up to 15% upscaling is allowed: jumping to the next bucket means 4× the pixels
 * and a re-render from an 11 MB JPEG, while the visual difference is invisible.
 */
function thumbSizeFor(boxWidth: number, boxHeight: number): number {
  const needed = Math.max(boxWidth, boxHeight) * (window.devicePixelRatio || 1);
  return THUMB_SIZES.find((s) => s >= needed * 0.85) ?? THUMB_SIZES[THUMB_SIZES.length - 1];
}

type Props = { photos: Photo[]; loading: boolean };

export default function PhotoGrid({ photos, loading }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const rowHeight = useStore((s) => s.rowHeight);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const selectionMode = useStore((s) => s.selectionMode);
  const selection = useStore((s) => s.selection);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const selectRange = useStore((s) => s.selectRange);

  const orderedIds = useMemo(() => photos.map((p) => p.id), [photos]);

  const handleOpen = (id: string, shiftKey: boolean) => {
    if (!selectionMode) {
      setActive(id);
      return;
    }
    if (shiftKey) selectRange(orderedIds, id);
    else toggleSelected(id);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width - PADDING * 2));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutJustified(photos, width, rowHeight, GAP), [photos, width, rowHeight]);

  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => layout.rows[i].height + GAP,
    overscan: 3,
  });

  // Keep the active photo's row in view while navigating by keyboard.
  useEffect(() => {
    if (!activeId) return;
    const rowIndex = layout.rows.findIndex((row) => row.boxes.some((box) => box.photo.id === activeId));
    if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
  }, [activeId, layout.rows, virtualizer]);

  if (!loading && photos.length === 0) {
    return (
      <div ref={scrollRef} className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-base-content/55">No photos match these filters.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto" style={{ padding: PADDING }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = layout.rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: row.height,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.boxes.map((box) => (
                <Thumb
                  key={box.photo.id}
                  photo={box.photo}
                  x={box.x}
                  width={box.width}
                  height={box.height}
                  active={box.photo.id === activeId}
                  picked={selection.has(box.photo.id)}
                  selectionMode={selectionMode}
                  onOpen={(shiftKey) => handleOpen(box.photo.id, shiftKey)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ThumbProps = {
  photo: Photo;
  x: number;
  width: number;
  height: number;
  /** The frame currently open in the lightbox. */
  active: boolean;
  /** Picked in selection mode. */
  picked: boolean;
  selectionMode: boolean;
  onOpen: (shiftKey: boolean) => void;
};

function Thumb({ photo, x, width, height, active, picked, selectionMode, onOpen }: ThumbProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const ring = picked
    ? 'ring-2 ring-primary ring-offset-1 ring-offset-base-100'
    : active
      ? 'ring-2 ring-base-content/40'
      : '';

  return (
    <button
      onClick={(event) => onOpen(event.shiftKey)}
      title={photo.name}
      aria-pressed={selectionMode ? picked : undefined}
      className={`group absolute top-0 overflow-hidden rounded-sm bg-base-200 outline-none ${ring}`}
      style={{ left: x, width, height }}
    >
      {failed ? (
        <span className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-base-content/50">
          no preview
        </span>
      ) : (
        <img
          src={thumbUrl(photo.id, thumbSizeFor(width, height))}
          alt={photo.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {selectionMode && (
        <span
          className={`absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded border ${
            picked
              ? 'border-primary bg-primary text-primary-content'
              : 'border-white/60 bg-black/40 text-transparent'
          }`}
        >
          <Check size={13} strokeWidth={3} />
        </span>
      )}

      {/* Make unlocated frames identifiable while selecting */}
      {selectionMode && photo.gps_lat === null && (
        <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white/80">
          <MapPinOff size={9} />
          unlocated
        </span>
      )}

      {photo.kind === 'raw' && (
        <span className="absolute top-1.5 left-1.5 rounded-sm bg-black/60 px-1 py-0.5 text-[9px] font-medium tracking-wide text-white/80">
          {photo.ext.replace('.', '').toUpperCase()}
        </span>
      )}

      {photo.rating > 0 && (
        <span className="absolute bottom-1 left-1.5 flex gap-px text-primary drop-shadow">
          {Array.from({ length: photo.rating }, (_, i) => (
            <Star key={i} size={9} fill="currentColor" strokeWidth={0} />
          ))}
        </span>
      )}

      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

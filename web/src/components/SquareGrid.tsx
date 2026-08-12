import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { type Photo, thumbUrl } from '../api.ts';

const TILE_MIN = 150;
const TILE_GAP = 8;

type Props = {
  photos: Photo[];
  onClick: (photo: Photo) => void;
  onDoubleClick?: (photo: Photo) => void;
  /** Badge drawn over each tile on hover — the action this grid performs. */
  overlay: (photo: Photo) => ReactNode;
  empty: ReactNode;
};

/**
 * A virtualised grid of square thumbnails.
 *
 * Uniform tiles make this the easy virtualisation case: rows are a fixed height,
 * so the whole library can be scrolled without the justified layout's bookkeeping.
 */
export default function SquareGrid({ photos, onClick, onDoubleClick, overlay, empty }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((width + TILE_GAP) / (TILE_MIN + TILE_GAP)));
  const tile = columns > 0 ? (width - TILE_GAP * (columns - 1)) / columns : TILE_MIN;
  const rows = Math.ceil(photos.length / columns);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => tile + TILE_GAP,
    overscan: 3,
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
      {photos.length === 0 ? (
        empty
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className="absolute top-0 left-0 flex w-full"
              style={{ gap: TILE_GAP, height: tile, transform: `translateY(${row.start}px)` }}
            >
              {photos.slice(row.index * columns, row.index * columns + columns).map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => onClick(photo)}
                  onDoubleClick={() => onDoubleClick?.(photo)}
                  title={photo.name}
                  className="group relative overflow-hidden rounded bg-base-200 ring-primary transition-shadow hover:ring-2"
                  style={{ width: tile, height: tile }}
                >
                  <img
                    src={thumbUrl(photo.id, 640)}
                    alt={photo.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    {overlay(photo)}
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
  );
}

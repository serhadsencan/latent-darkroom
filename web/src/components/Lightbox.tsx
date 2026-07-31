import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Info, Star, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, downloadUrl, type Photo, previewUrl } from '../api.ts';
import { formatAperture, formatFocal, formatIso, formatShutter } from '../lib/format.ts';
import { useStore } from '../store.ts';
import ExifPanel from './ExifPanel.tsx';
import TrashDialog from './TrashDialog.tsx';

type Props = { photos: Photo[] };

export default function Lightbox({ photos }: Props) {
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const infoOpen = useStore((s) => s.infoOpen);
  const toggleInfo = useStore((s) => s.toggleInfo);
  const [loaded, setLoaded] = useState(false);
  const [pendingTrash, setPendingTrash] = useState<Photo[]>([]);
  const queryClient = useQueryClient();

  const index = photos.findIndex((p) => p.id === activeId);
  const photo = index >= 0 ? photos[index] : null;

  /** Do not close on delete: advance to the next surviving frame (or the previous). */
  const advancePastTrashed = (trashedIds: string[]) => {
    const gone = new Set(trashedIds);
    const next = photos.slice(index + 1).find((p) => !gone.has(p.id));
    const prev = [...photos.slice(0, index)].reverse().find((p) => !gone.has(p.id));
    setActive(next?.id ?? prev?.id ?? null);
  };

  const rate = useMutation({
    mutationFn: ({ id, rating }: { id: string; rating: number }) => api.setMeta(id, { rating }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['photos'] }),
  });

  const step = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const next = photos[index + delta];
      if (next) setActive(next.id);
    },
    [index, photos, setActive],
  );

  useEffect(() => setLoaded(false), [activeId]);

  useEffect(() => {
    if (!photo) return;
    // Shortcuts are disabled while the confirm dialog is open, so nothing gets
    // rated or navigated behind it.
    if (pendingTrash.length > 0) return;

    const onKey = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          setActive(null);
          break;
        case 'Delete':
        case 'Backspace':
          // Never deletes directly; opens the confirmation dialog.
          setPendingTrash([photo]);
          break;
        case 'ArrowLeft':
          step(-1);
          break;
        case 'ArrowRight':
          step(1);
          break;
        case 'i':
          toggleInfo();
          break;
        default:
          if (/^[0-5]$/.test(event.key)) rate.mutate({ id: photo.id, rating: Number(event.key) });
          else return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo, step, setActive, toggleInfo, rate, pendingTrash.length]);

  if (!photo) return null;

  return (
    // The lightbox stays dark in every theme: judging colour and exposure against
    // a white surround is misleading.
    <div data-theme="dark" className="fixed inset-0 z-50 flex bg-base-100 text-base-content">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-base-300 px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="truncate text-[13px]">{photo.name}</span>
            <span className="tabular shrink-0 text-[11px] text-base-content/50">
              {index + 1} / {photos.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Stars value={photo.rating} onChange={(rating) => rate.mutate({ id: photo.id, rating })} />

            <div className="tooltip tooltip-bottom" data-tip="Download original">
              <a href={downloadUrl(photo.id)} aria-label="Download" className="btn btn-square btn-sm btn-ghost">
                <Download size={16} />
              </a>
            </div>

            <div className="tooltip tooltip-bottom" data-tip="Info panel (i)">
              <button
                onClick={toggleInfo}
                aria-label="Info"
                aria-pressed={infoOpen}
                className={`btn btn-square btn-sm btn-ghost ${infoOpen ? 'text-primary' : ''}`}
              >
                <Info size={16} />
              </button>
            </div>

            <div className="tooltip tooltip-bottom" data-tip="Move to Trash (Delete)">
              <button
                onClick={() => setPendingTrash([photo])}
                aria-label="Delete"
                className="btn btn-square btn-sm btn-ghost hover:text-error"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="tooltip tooltip-bottom tooltip-left" data-tip="Close (Esc)">
              <button onClick={() => setActive(null)} aria-label="Close" className="btn btn-square btn-sm btn-ghost">
                <X size={17} />
              </button>
            </div>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
          {!loaded && <span className="loading loading-spinner loading-md absolute opacity-40" />}
          <img
            key={photo.id}
            src={previewUrl(photo.id)}
            alt={photo.name}
            onLoad={() => setLoaded(true)}
            className={`max-h-full max-w-full object-contain transition-opacity duration-200 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />

          <NavButton side="left" disabled={index <= 0} onClick={() => step(-1)} />
          <NavButton side="right" disabled={index >= photos.length - 1} onClick={() => step(1)} />
        </div>

        {/* Must stay on one line: wrapping eats into the photo's area.
            On narrow windows the metadata scrolls and the key hints hide. */}
        <footer className="flex shrink-0 items-center gap-3 border-t border-base-300 px-3 py-2 text-[11px] text-base-content/55">
          <div className="tabular flex min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap">
            <span>{photo.camera_model ?? '—'}</span>
            <span>{photo.lens ?? '—'}</span>
            <span>{formatShutter(photo.shutter)}</span>
            <span>{formatAperture(photo.aperture)}</span>
            <span>{formatIso(photo.iso)}</span>
            <span>{formatFocal(photo.focal, photo.focal35)}</span>
            {photo.film_sim && (
              <span className="badge badge-xs badge-primary badge-outline shrink-0">{photo.film_sim}</span>
            )}
          </div>

          <span className="ml-auto hidden shrink-0 items-center gap-1.5 whitespace-nowrap xl:flex">
            <kbd className="kbd kbd-xs">←</kbd>
            <kbd className="kbd kbd-xs">→</kbd>
            move
            <kbd className="kbd kbd-xs">0-5</kbd>
            rate
            <kbd className="kbd kbd-xs">i</kbd>
            info
            <kbd className="kbd kbd-xs">esc</kbd>
            close
          </span>
        </footer>
      </div>

      {infoOpen && <ExifPanel photo={photo} />}

      <TrashDialog
        ids={pendingTrash.map((p) => p.id)}
        preview={pendingTrash}
        onClose={() => setPendingTrash([])}
        onDone={advancePastTrashed}
      />
    </div>
  );
}

function NavButton({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'previous' : 'next'}
      className={`btn btn-circle btn-ghost absolute ${
        side === 'left' ? 'left-3' : 'right-3'
      } opacity-0 transition-opacity hover:opacity-70 disabled:pointer-events-none`}
    >
      {side === 'left' ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );
}

function Stars({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <div className="mr-1 flex items-center">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          // Clicking the same star again clears the rating.
          onClick={() => onChange(value === star ? 0 : star)}
          aria-label={`${star} stars`}
          className={`btn btn-square btn-ghost btn-xs ${star <= value ? 'text-primary' : 'text-base-content/25'}`}
        >
          <Star size={13} fill={star <= value ? 'currentColor' : 'none'} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}

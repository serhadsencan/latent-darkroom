import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { api, type Photo, thumbUrl } from '../api.ts';

type Props = {
  /** Ids to delete. Empty means the dialog is closed. */
  ids: string[];
  /**
   * Loaded Photo objects for the preview. The selection may have been made under a
   * different filter, so not every id appears here — deletion still goes by id.
   */
  preview: Photo[];
  onClose: () => void;
  onDone: (trashedIds: string[]) => void;
};

/**
 * Delete confirmation. Destructive enough that it cannot be dismissed in one click:
 * it states how many files go where, and how to get them back.
 */
export default function TrashDialog({ ids, preview: previewPhotos, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const confirmRef = useRef<HTMLButtonElement>(null);

  const trash = useMutation({
    mutationFn: () => api.trash(ids),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['facets'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      queryClient.invalidateQueries({ queryKey: ['geo-missing'] });
      onDone(ids);
      if (result.failedCount === 0) onClose();
    },
  });

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !trash.isPending) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, trash.isPending]);

  if (ids.length === 0) return null;

  const preview = previewPhotos.slice(0, 6);
  const failed = trash.data?.failed ?? {};
  const failedCount = trash.data?.failedCount ?? 0;

  return (
    // Dark in every theme, like the lightbox: this appears on top of a photo.
    <div data-theme="dark" className="modal modal-open z-[900]">
      <div className="modal-box max-w-md border border-base-300">
        <h3 className="flex items-center gap-2 text-[15px] font-medium">
          <Trash2 size={17} className="text-error" />
          {ids.length === 1 ? 'Move photo to Trash' : `Move ${ids.length} photos to Trash`}
        </h3>

        <p className="mt-2 text-[12px] leading-relaxed text-base-content/70">
          The files leave their folder and go to the macOS Trash. If you change your mind,{' '}
          <strong className="font-medium text-base-content">Put Back</strong> in Finder restores them to exactly
          where they were. Nothing is permanently deleted until you empty the Trash.
        </p>

        <div className="mt-4 flex gap-1.5">
          {preview.map((photo) => (
            <img key={photo.id} src={thumbUrl(photo.id, 320)} alt="" className="h-14 w-14 rounded object-cover" />
          ))}
          {ids.length > preview.length && (
            <span className="tabular flex h-14 w-14 items-center justify-center rounded bg-base-300 text-[12px]">
              +{ids.length - preview.length}
            </span>
          )}
        </div>

        {failedCount > 0 && (
          <div role="alert" className="alert alert-warning mt-4 py-2 text-[11px]">
            <AlertTriangle size={15} />
            <span>
              {failedCount} file(s) could not be moved: {[...new Set(Object.values(failed))].join(', ')}
            </span>
          </div>
        )}

        {trash.isError && (
          <div role="alert" className="alert alert-error mt-4 py-2 text-[11px]">
            <AlertTriangle size={15} />
            <span>{String(trash.error)}</span>
          </div>
        )}

        <div className="modal-action">
          <button onClick={onClose} disabled={trash.isPending} className="btn btn-sm btn-ghost">
            cancel
          </button>
          <button ref={confirmRef} onClick={() => trash.mutate()} disabled={trash.isPending} className="btn btn-sm btn-error">
            {trash.isPending && <span className="loading loading-spinner loading-xs" />}
            {trash.isPending ? 'moving…' : 'move to Trash'}
          </button>
        </div>
      </div>

      <button className="modal-backdrop" onClick={() => !trash.isPending && onClose()} aria-label="Close" />
    </div>
  );
}

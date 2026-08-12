import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Layers, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { groups as groupsApi, type Photo, thumbUrl } from '../api.ts';

type Props = {
  /** Photos to add. Empty means the dialog is closed. */
  ids: string[];
  /** Loaded Photo objects for the preview strip; may be a subset of `ids`. */
  preview: Photo[];
  onClose: () => void;
  onDone: () => void;
};

/**
 * Adds the current selection to a group, existing or brand new.
 *
 * Creating and adding is one step on purpose: "these five go somewhere new" is the
 * common case, and making the user leave for the groups page first would break it.
 */
export default function AddToGroupDialog({ ids, preview, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [added, setAdded] = useState<{ name: string; count: number } | null>(null);

  /**
   * Frozen at open: adding clears the gallery selection, which would otherwise
   * empty `ids` out from under the dialog and close it before the result is read.
   */
  const [frozenIds] = useState(ids);
  const [frozenPreview] = useState(preview);

  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: groupsApi.list });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['group'] });
  };

  const addToExisting = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => ({
      name,
      result: await groupsApi.addItems(id, frozenIds),
    }),
    onSuccess: ({ name, result }) => {
      setAdded({ name, count: result.added });
      refresh();
      onDone();
    },
  });

  const createAndAdd = useMutation({
    mutationFn: async (name: string) => {
      const group = await groupsApi.create(name);
      return { name: group.name, result: await groupsApi.addItems(group.id, frozenIds) };
    },
    onSuccess: ({ name, result }) => {
      setAdded({ name, count: result.added });
      setNewName('');
      refresh();
      onDone();
    },
  });

  const busy = addToExisting.isPending || createAndAdd.isPending;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);

  if (frozenIds.length === 0) return null;

  const failed = addToExisting.isError || createAndAdd.isError;

  return (
    <div className="modal modal-open z-[900]">
      <div className="modal-box max-w-md border border-base-300">
        <h3 className="flex items-center gap-2 text-[15px] font-medium">
          <Layers size={17} className="text-primary" />
          Add {frozenIds.length} {frozenIds.length === 1 ? 'photo' : 'photos'} to a group
        </h3>

        <div className="mt-4 flex gap-1.5">
          {frozenPreview.slice(0, 6).map((photo) => (
            <img key={photo.id} src={thumbUrl(photo.id, 320)} alt="" className="h-12 w-12 rounded object-cover" />
          ))}
          {frozenIds.length > 6 && (
            <span className="tabular flex h-12 w-12 items-center justify-center rounded bg-base-300 text-[12px]">
              +{frozenIds.length - 6}
            </span>
          )}
        </div>

        {added && (
          <div role="alert" className="alert alert-success mt-4 py-2 text-[11px]">
            <Check size={15} />
            <span>
              {added.count === 0
                ? `Already in “${added.name}”.`
                : `Added ${added.count} to “${added.name}”.`}
            </span>
          </div>
        )}

        {failed && (
          <div role="alert" className="alert alert-error mt-4 py-2 text-[11px]">
            <AlertTriangle size={15} />
            <span>Could not add to that group.</span>
          </div>
        )}

        <div className="mt-4 max-h-56 overflow-y-auto">
          {groups && groups.length > 0 ? (
            <ul className="menu menu-sm w-full gap-0.5 p-0">
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    onClick={() => addToExisting.mutate({ id: group.id, name: group.name })}
                    disabled={busy}
                    className="flex items-center gap-2 py-1.5"
                  >
                    {group.cover ? (
                      <img src={thumbUrl(group.cover, 320)} alt="" className="h-6 w-6 rounded-sm object-cover" />
                    ) : (
                      <span className="h-6 w-6 rounded-sm bg-base-300" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-left">{group.name}</span>
                    <span className="tabular text-[11px] opacity-55">{group.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-[12px] text-base-content/55">No groups yet — name one below.</p>
          )}
        </div>

        <div className="mt-3 flex gap-1.5 border-t border-base-300 pt-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim() && !busy) createAndAdd.mutate(newName.trim());
            }}
            placeholder="New group name"
            aria-label="New group name"
            className="input input-sm flex-1 bg-base-100"
          />
          <button
            onClick={() => createAndAdd.mutate(newName.trim())}
            disabled={!newName.trim() || busy}
            className="btn btn-sm btn-primary gap-1.5"
          >
            {createAndAdd.isPending ? <span className="loading loading-spinner loading-xs" /> : <Plus size={14} />}
            create
          </button>
        </div>

        <div className="modal-action">
          <button onClick={onClose} disabled={busy} className="btn btn-sm btn-ghost">
            {added ? 'done' : 'cancel'}
          </button>
        </div>
      </div>

      <button className="modal-backdrop" onClick={() => !busy && onClose()} aria-label="Close" />
    </div>
  );
}

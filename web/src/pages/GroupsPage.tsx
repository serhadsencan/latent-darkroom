import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Layers, Pencil, Plus, Search, StickyNote, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, groups as groupsApi, type GroupSummary, type Photo, thumbUrl } from '../api.ts';
import Lightbox from '../components/Lightbox.tsx';
import SquareGrid from '../components/SquareGrid.tsx';
import { useStore } from '../store.ts';

/** Which group was last open — a UI preference, so the browser is the right home. */
const ACTIVE_KEY = 'ld:active-group';

export default function GroupsPage() {
  const setActive = useStore((s) => s.setActive);
  const selection = useStore((s) => s.selection);
  const queryClient = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);

  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: groupList } = useQuery({ queryKey: ['groups'], queryFn: groupsApi.list });

  // Fall back to the most recently touched group when the stored one is gone.
  const activeGroup = groupList?.find((g) => g.id === activeId) ?? groupList?.[0];
  useEffect(() => {
    if (activeGroup && activeGroup.id !== activeId) {
      setActiveId(activeGroup.id);
      localStorage.setItem(ACTIVE_KEY, activeGroup.id);
    }
  }, [activeGroup, activeId]);

  useEffect(() => {
    setConfirmDelete(false);
    setRenaming(false);
  }, [activeId]);

  const selectGroup = (id: string) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_KEY, id);
  };

  const { data: openGroup } = useQuery({
    queryKey: ['group', activeGroup?.id],
    queryFn: () => groupsApi.get(activeGroup!.id),
    enabled: Boolean(activeGroup),
  });

  // The note is edited locally and written on blur, so typing is not a request per key.
  useEffect(() => {
    setNote(openGroup?.note ?? '');
    setNoteOpen(Boolean(openGroup?.note));
  }, [openGroup]);

  const members = openGroup?.photos ?? [];
  const memberIds = useMemo(() => new Set(members.map((p) => p.id)), [members]);

  /** Search results come from the whole library, not from the group. */
  const { data: results } = useQuery({
    queryKey: ['group-search', search],
    queryFn: () => api.photos({ q: search }, 500, 0),
    enabled: search.length > 0,
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['group', activeGroup?.id] });
  };

  const addItems = useMutation({
    mutationFn: (ids: string[]) => groupsApi.addItems(activeGroup!.id, ids),
    onSuccess: refresh,
  });
  const removeItems = useMutation({
    mutationFn: (ids: string[]) => groupsApi.removeItems(activeGroup!.id, ids),
    onSuccess: refresh,
  });

  const createGroup = useMutation({
    mutationFn: () => groupsApi.create(),
    onSuccess: async ({ id, name }) => {
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      selectGroup(id);
      // A fresh group is called "Untitled"; open the rename box straight away.
      setDraft(name);
      setRenaming(true);
    },
  });

  const renameGroup = useMutation({
    mutationFn: (name: string) => groupsApi.update(activeGroup!.id, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['groups'] }),
  });

  const saveNote = useMutation({
    mutationFn: (value: string) => groupsApi.update(activeGroup!.id, { note: value }),
    onSuccess: refresh,
  });

  const commitNote = () => {
    if (!activeGroup) return;
    if (note.trim() !== (openGroup?.note ?? '')) saveNote.mutate(note);
  };

  const deleteGroup = useMutation({
    mutationFn: () => groupsApi.remove(activeGroup!.id),
    onSuccess: async () => {
      localStorage.removeItem(ACTIVE_KEY);
      setActiveId(null);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  const commitRename = () => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== activeGroup?.name) renameGroup.mutate(draft.trim());
  };

  const searching = search.length > 0;
  const shown = searching ? (results?.photos ?? []) : members;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <header className="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-base-300 bg-base-200 px-3 py-2">
        <span className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
          <Layers size={15} strokeWidth={1.75} className="text-primary" />
          Groups
        </span>

        {/* The search box drives the main area: empty shows the group, a query
            shows the library so anything can be added without leaving the page. */}
        <label className="input input-sm w-72 min-w-32 shrink gap-2 bg-base-100">
          <Search size={15} strokeWidth={1.75} className="opacity-50" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search the library to add photos"
            className="grow"
            disabled={!activeGroup}
          />
          {term && (
            <button onClick={() => setTerm('')} aria-label="Clear search" className="opacity-50 hover:opacity-100">
              <X size={14} />
            </button>
          )}
        </label>

        {activeGroup && (
          <span className="tabular hidden shrink-0 text-xs whitespace-nowrap text-base-content/55 @lg:inline">
            {searching
              ? `${shown.length} found · ${activeGroup.count} in group`
              : `${members.length} ${members.length === 1 ? 'photo' : 'photos'}`}
          </span>
        )}

        {activeGroup && selection.size > 0 && !searching && (
          <button
            onClick={() => addItems.mutate([...selection])}
            className="btn btn-sm btn-ghost ml-auto shrink-0 gap-1.5"
          >
            <Plus size={14} />
            add {selection.size} selected
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-base-300 bg-base-200">
          <div className="flex items-center gap-2 border-b border-base-300 px-3 py-2">
            <span className="text-[11px] font-medium tracking-wider text-base-content/55 uppercase">Groups</span>
            <div className="tooltip tooltip-right ml-auto" data-tip="New group">
              <button
                onClick={() => createGroup.mutate()}
                aria-label="New group"
                className="btn btn-square btn-xs btn-ghost"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {(groupList ?? []).length === 0 ? (
              <p className="px-2 py-3 text-[12px] leading-relaxed text-base-content/55">
                No groups yet. Create one to start collecting.
              </p>
            ) : (
              <ul className="menu menu-sm w-full gap-0.5 p-0">
                {groupList?.map((group) => (
                  <li key={group.id}>
                    <button
                      onClick={() => selectGroup(group.id)}
                      className={`flex items-center gap-2 py-1.5 ${group.id === activeGroup?.id ? 'menu-active' : ''}`}
                    >
                      <GroupCover group={group} />
                      <span className="min-w-0 flex-1 truncate text-left text-[13px]">{group.name}</span>
                      <span className="tabular shrink-0 text-[11px] opacity-55">{group.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {activeGroup && (
            <div className="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-2">
              {renaming ? (
                <>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenaming(false);
                    }}
                    onBlur={commitRename}
                    // Select on focus so typing replaces the placeholder name.
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Group name"
                    className="input input-sm w-56 bg-base-100"
                    autoFocus
                  />
                  <button onClick={commitRename} aria-label="Save name" className="btn btn-square btn-sm btn-ghost text-primary">
                    <Check size={15} />
                  </button>
                </>
              ) : (
                <>
                  <h2 className="truncate text-[14px] font-medium">{activeGroup.name}</h2>
                  <div className="tooltip tooltip-bottom" data-tip="Rename">
                    <button
                      onClick={() => {
                        setDraft(activeGroup.name);
                        setRenaming(true);
                      }}
                      aria-label="Rename group"
                      className="btn btn-square btn-xs btn-ghost"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                  <div className="tooltip tooltip-bottom" data-tip={noteOpen ? 'Hide note' : 'Add a note'}>
                    <button
                      onClick={() => setNoteOpen((v) => !v)}
                      aria-label="Group note"
                      aria-pressed={noteOpen}
                      className={`btn btn-square btn-xs ${noteOpen ? 'btn-ghost text-primary' : 'btn-ghost'}`}
                    >
                      <StickyNote size={13} />
                    </button>
                  </div>
                  <div
                    className="tooltip tooltip-bottom"
                    data-tip={confirmDelete ? 'Click again to confirm' : 'Delete group'}
                  >
                    <button
                      onClick={() => (confirmDelete ? deleteGroup.mutate() : setConfirmDelete(true))}
                      onBlur={() => setConfirmDelete(false)}
                      aria-label="Delete group"
                      className={`btn btn-square btn-xs ${confirmDelete ? 'btn-error' : 'btn-ghost'}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}

              {searching && (
                <span className="ml-auto text-[11px] text-base-content/55">
                  Showing library search — click a photo to add it
                </span>
              )}
            </div>
          )}

          {activeGroup && noteOpen && (
            <div className="shrink-0 border-b border-base-300 px-4 py-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={commitNote}
                placeholder="Notes about this group — what it is for, what still needs picking…"
                rows={2}
                aria-label="Group note"
                className="textarea textarea-sm w-full resize-y bg-base-100 text-[12px] leading-relaxed"
              />
              {saveNote.isPending && <span className="text-[10px] text-base-content/45">saving…</span>}
            </div>
          )}

          {!activeGroup ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="card border border-base-300 bg-base-200">
                <div className="card-body items-center gap-2 text-center">
                  <Layers size={22} className="text-base-content/40" />
                  <h2 className="card-title text-base">No group selected</h2>
                  <p className="text-[13px] leading-relaxed text-base-content/70">
                    Create a group on the left, then search the library to fill it.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <SquareGrid
              photos={shown}
              onClick={(photo) =>
                searching
                  ? memberIds.has(photo.id)
                    ? removeItems.mutate([photo.id])
                    : addItems.mutate([photo.id])
                  : removeItems.mutate([photo.id])
              }
              onDoubleClick={(photo) => setActive(photo.id)}
              overlay={(photo) =>
                searching && !memberIds.has(photo.id) ? (
                  <span className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-content">
                    <Plus size={13} strokeWidth={2.5} />
                    add
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-error px-2.5 py-1 text-[11px] font-medium text-error-content">
                    <X size={13} strokeWidth={2.5} />
                    remove
                  </span>
                )
              }
              empty={
                <p className="text-[13px] leading-relaxed text-base-content/55">
                  {searching ? 'Nothing matches that search.' : 'This group is empty — search above to add photos.'}
                </p>
              }
            />
          )}
        </div>
      </div>

      <Lightbox photos={shown} />
    </div>
  );
}

/** Small cover thumbnail, or a neutral placeholder for an empty group. */
function GroupCover({ group }: { group: GroupSummary }) {
  if (!group.cover) {
    return <span className="h-6 w-6 shrink-0 rounded-sm bg-base-300" />;
  }
  return (
    <img src={thumbUrl(group.cover, 320)} alt="" className="h-6 w-6 shrink-0 rounded-sm object-cover" />
  );
}

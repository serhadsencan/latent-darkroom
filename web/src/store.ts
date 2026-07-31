import { create } from 'zustand';
import type { Filters } from './api.ts';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const THEME_KEY = 'ld:theme';

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'dark';
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? systemTheme() : theme;
}

/**
 * Below this width the sidebar costs more than it gives: rail + sidebar eat 304px,
 * which leaves the grid with almost nothing and pushes the top bar into overflow.
 */
export const SIDEBAR_BREAKPOINT = 900;

type State = {
  filters: Filters;
  /** Target row height in the justified grid — the density control. */
  rowHeight: number;
  sidebarOpen: boolean;
  infoOpen: boolean;
  /** Id of the photo open in the lightbox. */
  activeId: string | null;

  /** Selection mode and picked ids — carried across pages (select in gallery, assign on map). */
  selectionMode: boolean;
  selection: Set<string>;
  /** Last clicked id, used as the anchor for shift-range selection. */
  lastSelectedId: string | null;

  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;
  setRowHeight: (height: number) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleInfo: () => void;
  setActive: (id: string | null) => void;

  theme: Theme;
  setTheme: (theme: Theme) => void;

  setSelectionMode: (on: boolean) => void;
  toggleSelected: (id: string) => void;
  /** Adds the range from the anchor to the given id into the selection. */
  selectRange: (orderedIds: string[], toId: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
};

const DEFAULT_FILTERS: Filters = { sort: 'taken', order: 'desc' };

export const useStore = create<State>((set) => ({
  filters: DEFAULT_FILTERS,
  rowHeight: 240,
  // Start collapsed on a narrow window rather than opening and immediately cramping.
  sidebarOpen: window.innerWidth >= SIDEBAR_BREAKPOINT,
  infoOpen: true,
  activeId: null,
  selectionMode: false,
  selection: new Set<string>(),
  lastSelectedId: null,
  theme: readStoredTheme(),

  setFilter: (key, value) =>
    set((state) => {
      const next = { ...state.filters };
      // Clicking the same value again clears the filter.
      if (value === undefined || value === '' || next[key] === value) delete next[key];
      else next[key] = value;
      return { filters: next };
    }),
  resetFilters: () => set({ filters: DEFAULT_FILTERS }),
  setRowHeight: (rowHeight) => set({ rowHeight: Math.min(Math.max(rowHeight, 120), 520) }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),
  setActive: (activeId) => set({ activeId }),

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },

  // Leaving selection mode keeps the picked frames: the user selects in the
  // gallery then moves to the map, and the selection must survive the trip.
  setSelectionMode: (selectionMode) => set({ selectionMode }),

  toggleSelected: (id) =>
    set((state) => {
      const selection = new Set(state.selection);
      if (selection.has(id)) selection.delete(id);
      else selection.add(id);
      return { selection, lastSelectedId: id };
    }),

  selectRange: (orderedIds, toId) =>
    set((state) => {
      const anchor = state.lastSelectedId;
      const to = orderedIds.indexOf(toId);
      const from = anchor ? orderedIds.indexOf(anchor) : -1;
      if (to === -1) return {};
      // With no anchor (or one not in the list), behave like a single pick.
      if (from === -1) {
        const selection = new Set(state.selection);
        selection.add(toId);
        return { selection, lastSelectedId: toId };
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      const selection = new Set(state.selection);
      for (let i = start; i <= end; i++) selection.add(orderedIds[i]);
      return { selection, lastSelectedId: toId };
    }),

  selectAll: (ids) => set({ selection: new Set(ids), lastSelectedId: ids[ids.length - 1] ?? null }),
  clearSelection: () => set({ selection: new Set<string>(), lastSelectedId: null }),
}));

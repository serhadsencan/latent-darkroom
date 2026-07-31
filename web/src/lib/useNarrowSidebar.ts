import { useEffect, useRef } from 'react';
import { SIDEBAR_BREAKPOINT, useStore } from '../store.ts';

/**
 * Collapses the sidebar when the window becomes too narrow to carry it.
 *
 * One-way on purpose: crossing below the breakpoint closes it, but growing again
 * does not force it back open. Re-opening automatically would override a
 * deliberate choice every time the window is nudged.
 */
export function useNarrowSidebar(): void {
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const wasNarrow = useRef(window.innerWidth < SIDEBAR_BREAKPOINT);

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${SIDEBAR_BREAKPOINT - 1}px)`);

    const onChange = () => {
      const narrow = media.matches;
      if (narrow && !wasNarrow.current) setSidebarOpen(false);
      wasNarrow.current = narrow;
    };

    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [setSidebarOpen]);
}

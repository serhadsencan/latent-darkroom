import { useEffect, useState } from 'react';
import { resolveTheme, systemTheme, useStore, type ResolvedTheme } from '../store.ts';

/**
 * Writes the active theme to `<html data-theme>` and returns the resolved value.
 *
 * With "system" selected it follows OS preference changes live, which is why it
 * subscribes to the media query instead of reading it once.
 */
export function useTheme(): ResolvedTheme {
  const theme = useStore((s) => s.theme);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme));

  useEffect(() => {
    setResolved(resolveTheme(theme));
    if (theme !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setResolved(systemTheme());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  return resolved;
}

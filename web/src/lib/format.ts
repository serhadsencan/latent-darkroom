const LOCALE = 'en-GB';

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dayFmt = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'long', year: 'numeric' });

export const formatDate = (ms: number | null) => (ms ? dateFmt.format(new Date(ms)) : '—');
export const formatDay = (ms: number | null) => (ms ? dayFmt.format(new Date(ms)) : 'No date');

/** Classic 1/250 s notation; exposures over a second use the 2.5" form. */
export function formatShutter(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}"`;
  return `1/${Math.round(1 / seconds)}`;
}

export const formatAperture = (f: number | null) => (f ? `ƒ/${Number(f.toFixed(1))}` : '—');

export function formatFocal(focal: number | null, focal35: number | null): string {
  if (!focal) return '—';
  const base = `${Math.round(focal)}mm`;
  // Show the 35mm equivalent when it differs meaningfully (always does on APS-C).
  if (focal35 && Math.abs(focal35 - focal) > 1) return `${base} (${Math.round(focal35)}mm eq.)`;
  return base;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

export const formatIso = (iso: number | null) => (iso ? `ISO ${iso}` : '—');

/** Thousands separators for counts shown in the chrome. */
export const formatCount = (n: number) => n.toLocaleString(LOCALE);

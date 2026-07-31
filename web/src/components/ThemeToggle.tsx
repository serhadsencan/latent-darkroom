import { Monitor, Moon, Sun } from 'lucide-react';
import { useStore, type Theme } from '../store.ts';

const ORDER: Theme[] = ['dark', 'light', 'system'];

const OPTIONS: Record<Theme, { Icon: typeof Sun; label: string }> = {
  dark: { Icon: Moon, label: 'Dark theme' },
  light: { Icon: Sun, label: 'Light theme' },
  system: { Icon: Monitor, label: 'Follow system' },
};

export default function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  const { Icon, label } = OPTIONS[theme];
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

  return (
    <div className="tooltip tooltip-right" data-tip={`${label} → ${OPTIONS[next].label.toLowerCase()}`}>
      <button
        onClick={() => setTheme(next)}
        aria-label={label}
        className="btn btn-square btn-ghost btn-sm h-11 w-11 text-base-content/55"
      >
        <Icon size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
}

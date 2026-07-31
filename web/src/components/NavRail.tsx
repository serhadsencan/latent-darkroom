import { NavLink } from 'react-router-dom';
import { PAGES } from '../pages.tsx';
import { LogoMark } from './Logo.tsx';
import ThemeToggle from './ThemeToggle.tsx';

export default function NavRail() {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-base-300 bg-base-200 py-3">
      <NavLink to="/" title="latent darkroom" className="mb-3">
        <LogoMark size={32} />
      </NavLink>

      {PAGES.map(({ path, label, Icon }) => (
        <div key={path} className="tooltip tooltip-right" data-tip={label}>
          <NavLink
            to={path}
            // Keep the root route from matching on other pages.
            end={path === '/'}
            className={({ isActive }) =>
              `btn btn-square btn-ghost btn-sm h-11 w-11 ${isActive ? 'bg-base-300 text-primary' : 'text-base-content/55'}`
            }
          >
            <Icon size={19} strokeWidth={1.75} />
          </NavLink>
        </div>
      ))}

      <div className="mt-auto">
        <ThemeToggle />
      </div>
    </nav>
  );
}

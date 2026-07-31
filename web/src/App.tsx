import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { Outlet, Route, Routes } from 'react-router-dom';
import { api } from './api.ts';
import { LogoLockup } from './components/Logo.tsx';
import NavRail from './components/NavRail.tsx';
import { useNarrowSidebar } from './lib/useNarrowSidebar.ts';
import { useTheme } from './lib/useTheme.ts';
import { PAGES } from './pages.tsx';

export default function App() {
  // Writes the theme onto <html data-theme>; every colour token resolves from it.
  useTheme();
  useNarrowSidebar();
  const { data: status } = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 5_000 });

  // Without a root folder no page means anything — handle before routing.
  if (status && !status.rootsConfigured) return <SetupScreen />;

  return (
    <Routes>
      <Route element={<Shell />}>
        {PAGES.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function Shell() {
  return (
    // overflow-hidden on the shell: the app is a fixed viewport, only inner panes
    // scroll. Without it one wide child scrolls the whole page sideways.
    <div className="flex h-full overflow-hidden">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <span className="loading loading-spinner loading-md opacity-40" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

function NotFound() {
  return <div className="flex flex-1 items-center justify-center text-sm text-base-content/55">No such page.</div>;
}

function SetupScreen() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="card w-full max-w-lg border border-base-300 bg-base-200">
        <div className="card-body gap-4">
          <LogoLockup size={56} />
          <div>
            <h1 className="card-title text-base">Point it at a folder first</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-base-content/70">
              Copy <code className="rounded bg-base-300 px-1">.env.example</code> in the project root to{' '}
              <code className="rounded bg-base-300 px-1">.env</code> and set{' '}
              <code className="rounded bg-base-300 px-1">PHOTO_ROOTS</code> to your photo folder. Separate
              multiple folders with <code className="rounded bg-base-300 px-1">:</code>.
            </p>
          </div>
          <pre className="mockup-code text-[12px]">
            <code>{'cp .env.example .env\n# edit the PHOTO_ROOTS=... line\nnpm run scan'}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../api.ts';
import Lightbox from '../components/Lightbox.tsx';
import PhotoGrid from '../components/PhotoGrid.tsx';
import Sidebar from '../components/Sidebar.tsx';
import Topbar from '../components/Topbar.tsx';
import { useStore } from '../store.ts';

export default function GalleryPage() {
  const filters = useStore((s) => s.filters);
  const sidebarOpen = useStore((s) => s.sidebarOpen);

  const { data: status } = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 5_000 });

  const { data, isLoading } = useQuery({
    queryKey: ['photos', filters],
    queryFn: () => api.photos(filters, 2000, 0),
    // Keep the grid from emptying and jumping when filters change.
    placeholderData: keepPreviousData,
  });

  const photos = data?.photos ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && <Sidebar />}
      {/* @container so the top bar hides controls based on ITS width — the sidebar
          can take 240px away without the viewport changing at all. */}
      <main className="@container flex min-w-0 flex-1 flex-col">
        <Topbar total={data?.total ?? 0} photos={photos} />
        {status && status.total === 0 ? (
          <EmptyLibrary roots={status.roots} />
        ) : (
          <div className="min-h-0 flex-1">
            <PhotoGrid photos={photos} loading={isLoading} />
          </div>
        )}
      </main>
      <Lightbox photos={photos} />
    </div>
  );
}

function EmptyLibrary({ roots }: { roots: string[] }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="card max-w-lg border border-base-300 bg-base-200">
        <div className="card-body items-center gap-2 text-center">
          <RefreshCw size={22} className="text-base-content/40" />
          <h1 className="card-title text-base">Index is empty</h1>
          <p className="text-[13px] leading-relaxed text-base-content/70">
            Roots are configured but nothing has been scanned yet. Press the refresh button above, or run{' '}
            <code className="rounded bg-base-300 px-1">npm run scan</code> in a terminal.
          </p>
          <div className="text-[12px] text-base-content/45">{roots.join(' · ')}</div>
        </div>
      </div>
    </div>
  );
}

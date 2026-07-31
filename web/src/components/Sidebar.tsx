import { useQuery } from '@tanstack/react-query';
import { Aperture, Calendar, Camera, Film, Folder, Image, MapPin, Star } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { api, type Facet, type Filters } from '../api.ts';
import { useStore } from '../store.ts';
import { LogoMark } from './Logo.tsx';

type FacetGroupProps = {
  title: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  items: Facet[];
  filterKey: keyof Filters;
  labelOf?: (value: string) => string;
  initiallyOpen?: boolean;
  limit?: number;
};

function FacetGroup({ title, Icon, items, filterKey, labelOf, initiallyOpen = false, limit = 8 }: FacetGroupProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [showAll, setShowAll] = useState(false);
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);

  if (items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, limit);
  const active = filters[filterKey] as string | undefined;

  return (
    <div className="border-b border-base-300">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-[11px] font-medium tracking-wider text-base-content/55 uppercase hover:text-base-content"
      >
        <Icon size={14} strokeWidth={1.75} />
        <span>{title}</span>
        {active && <span className="badge badge-xs badge-primary ml-auto" />}
        <span className={`tabular text-base-content/35 ${active ? '' : 'ml-auto'}`}>{items.length}</span>
      </button>

      {open && (
        <ul className="menu menu-sm w-full gap-0 px-1.5 pb-2">
          {visible.map((item) => {
            const isActive = active === item.value;
            return (
              <li key={item.value}>
                <button
                  onClick={() => setFilter(filterKey, item.value as never)}
                  className={`flex justify-between gap-2 py-1.5 ${isActive ? 'menu-active' : ''}`}
                >
                  <span className="truncate">{labelOf ? labelOf(item.value) : item.value}</span>
                  <span className="tabular shrink-0 text-[11px] opacity-55">{item.count}</span>
                </button>
              </li>
            );
          })}
          {items.length > limit && (
            <li>
              <button onClick={() => setShowAll((v) => !v)} className="py-1.5 text-[11px] opacity-60">
                {showAll ? 'show less' : `+${items.length - limit} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** A small toggle group — pressing the active value again clears the filter. */
function ToggleGroup<K extends keyof Filters>({
  title,
  Icon,
  filterKey,
  options,
}: {
  title: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  filterKey: K;
  options: { value: NonNullable<Filters[K]>; label: string }[];
}) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);

  return (
    <div className="border-b border-base-300 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wider text-base-content/55 uppercase">
        <Icon size={14} strokeWidth={1.75} />
        {title}
      </div>
      <div className="join w-full">
        {options.map((option) => (
          <button
            key={String(option.value)}
            onClick={() => setFilter(filterKey, option.value)}
            className={`btn join-item btn-xs flex-1 ${
              filters[filterKey] === option.value ? 'btn-primary' : 'btn-ghost bg-base-100'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { data } = useQuery({ queryKey: ['facets'], queryFn: api.facets });
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);

  const activeCount = Object.keys(filters).filter((k) => k !== 'sort' && k !== 'order').length;

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col overflow-y-auto border-r border-base-300 bg-base-200">
      <div className="flex items-center gap-2 border-b border-base-300 px-3 py-3">
        <LogoMark size={26} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">
            <span className="text-primary">latent</span> darkroom
          </div>
          <div className="text-[11px] text-base-content/55">local library</div>
        </div>
        {activeCount > 0 && (
          <button onClick={resetFilters} className="btn btn-xs btn-ghost text-primary">
            clear
          </button>
        )}
      </div>

      <FacetGroup title="Year" Icon={Calendar} items={data?.years ?? []} filterKey="year" initiallyOpen limit={12} />
      <FacetGroup
        title="Folder"
        Icon={Folder}
        items={data?.folders ?? []}
        filterKey="dir"
        labelOf={(v) => v || '(root)'}
        initiallyOpen
        limit={12}
      />
      <FacetGroup title="Film simulation" Icon={Film} items={data?.films ?? []} filterKey="film" />
      <FacetGroup title="Body" Icon={Camera} items={data?.cameras ?? []} filterKey="camera" />
      <FacetGroup title="Lens" Icon={Aperture} items={data?.lenses ?? []} filterKey="lens" />

      <ToggleGroup
        title="File"
        Icon={Image}
        filterKey="kind"
        options={[
          { value: 'image', label: 'JPEG' },
          { value: 'raw', label: 'RAW' },
        ]}
      />

      <ToggleGroup
        title="Location"
        Icon={MapPin}
        filterKey="gps"
        options={[
          { value: '1', label: 'Located' },
          { value: '0', label: 'Unlocated' },
        ]}
      />

      <div className="px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wider text-base-content/55 uppercase">
          <Star size={14} strokeWidth={1.75} />
          Min rating
        </div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => {
            const on = (filters.minRating ?? 0) >= star;
            return (
              <button
                key={star}
                onClick={() => setFilter('minRating', star)}
                aria-label={`${star} stars and up`}
                className={`btn btn-square btn-xs ${on ? 'btn-ghost text-primary' : 'btn-ghost text-base-content/30'}`}
              >
                <Star size={13} fill={on ? 'currentColor' : 'none'} strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

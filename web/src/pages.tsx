import { Images, MapPin } from 'lucide-react';
import { lazy, type ComponentType } from 'react';
import GalleryPage from './pages/GalleryPage.tsx';

// Leaflet + markercluster is ~230 kB; keep it off the gallery's critical path.
const MapPage = lazy(() => import('./pages/MapPage.tsx'));

export type PageDef = {
  path: string;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  Component: ComponentType;
};

/**
 * One line here adds a page: the route, the rail button and lazy loading all
 * follow automatically.
 */
export const PAGES: PageDef[] = [
  { path: '/', label: 'Gallery', Icon: Images, Component: GalleryPage },
  { path: '/map', label: 'Map', Icon: MapPin, Component: MapPage },
];

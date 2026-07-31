import { useQuery } from '@tanstack/react-query';
import { Aperture, Camera, ExternalLink, FileImage, MapPin } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { api, type Photo } from '../api.ts';
import {
  formatAperture,
  formatBytes,
  formatDate,
  formatFocal,
  formatIso,
  formatShutter,
} from '../lib/format.ts';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="shrink-0 text-base-content/50">{label}</dt>
      <dd className="tabular truncate text-right" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Section({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-base-300 px-3 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-[10px] font-medium tracking-wider text-base-content/50 uppercase">
        <Icon size={13} strokeWidth={1.75} />
        {title}
      </div>
      <dl className="text-[12px]">{children}</dl>
    </div>
  );
}

export default function ExifPanel({ photo }: { photo: Photo }) {
  // The list response carries the basics; full EXIF is fetched only for the open photo.
  const { data: detail } = useQuery({
    queryKey: ['photo', photo.id],
    queryFn: () => api.photo(photo.id),
  });

  const dims = photo.width && photo.height ? `${photo.width} × ${photo.height}` : '—';
  const mp = photo.width && photo.height ? `${((photo.width * photo.height) / 1e6).toFixed(1)} MP` : '—';

  const geoSource =
    photo.gps_source === 'manual'
      ? 'manual'
      : photo.gps_source === 'interpolated'
        ? 'interpolated'
        : 'EXIF';

  return (
    <div className="h-full w-72 shrink-0 overflow-y-auto border-l border-base-300 bg-base-200">
      <div className="border-b border-base-300 px-3 py-3">
        <div className="truncate text-[13px] font-medium" title={photo.name}>
          {photo.name}
        </div>
        <div className="truncate text-[11px] text-base-content/50" title={photo.dir}>
          {photo.dir || '(root folder)'}
        </div>
      </div>

      <Section title="Capture" Icon={Aperture}>
        <Row label="Date" value={formatDate(photo.taken_at)} />
        <Row label="Shutter" value={formatShutter(photo.shutter)} />
        <Row label="Aperture" value={formatAperture(photo.aperture)} />
        <Row label="ISO" value={formatIso(photo.iso)} />
        <Row label="Focal" value={formatFocal(photo.focal, photo.focal35)} />
      </Section>

      <Section title="Gear" Icon={Camera}>
        <Row label="Body" value={photo.camera_model ?? '—'} />
        <Row label="Lens" value={photo.lens ?? '—'} />
        <Row label="Film sim." value={photo.film_sim ?? '—'} />
      </Section>

      <Section title="File" Icon={FileImage}>
        <Row label="Type" value={photo.ext.replace('.', '').toUpperCase()} />
        <Row label="Size" value={formatBytes(photo.size)} />
        <Row label="Resolution" value={dims} />
        <Row label="Megapixels" value={mp} />
      </Section>

      {photo.gps_lat != null && photo.gps_lon != null && (
        <Section title="Location" Icon={MapPin}>
          <Row label="Latitude" value={photo.gps_lat.toFixed(5)} />
          <Row label="Longitude" value={photo.gps_lon.toFixed(5)} />
          <Row label="Source" value={geoSource} />
          <a
            className="link mt-1.5 inline-flex items-center gap-1 text-[12px] text-primary"
            href={`https://www.openstreetmap.org/?mlat=${photo.gps_lat}&mlon=${photo.gps_lon}#map=15/${photo.gps_lat}/${photo.gps_lon}`}
            target="_blank"
            rel="noreferrer"
          >
            open in maps <ExternalLink size={12} />
          </a>
        </Section>
      )}

      {detail?.exif && (
        <div className="collapse-arrow collapse">
          <input type="checkbox" />
          <div className="collapse-title min-h-0 py-3 text-[10px] font-medium tracking-wider text-base-content/50 uppercase">
            Raw EXIF
          </div>
          <div className="collapse-content">
            <pre className="mockup-code max-h-80 overflow-auto text-[10px] leading-relaxed">
              {JSON.stringify(detail.exif, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

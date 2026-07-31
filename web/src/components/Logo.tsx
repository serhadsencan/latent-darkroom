import { useState } from 'react';

/**
 * The logo mark (emblem only, no wordmark), expected at `web/public/logo-mark.png`.
 *
 * If the file is absent the image is hidden and a text mark takes over, so the UI
 * never looks broken before the logo has been generated.
 */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full border border-primary/60 font-medium tracking-tight text-primary ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        ld
      </span>
    );
  }

  return (
    <img
      src="/logo-mark.png"
      alt="latent darkroom"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Emblem plus the "latent darkroom" wordmark, for roomier places like the setup screen. */
export function LogoLockup({ size = 56 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={size} />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-wide">
          <span className="text-primary">latent</span> darkroom
        </div>
        <div className="text-[11px] text-base-content/55">local photo library</div>
      </div>
    </div>
  );
}

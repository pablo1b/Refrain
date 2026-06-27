// The Refrain mark — concentric rings + a single radial hand (the cycle).
export function Logo({ size = 17, live = true }: { size?: number; live?: boolean }) {
  const ring = live ? 'var(--live)' : 'var(--text-2)';
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-label="Refrain">
      <circle cx="17" cy="17" r="15.5" stroke="var(--text-2)" strokeWidth="1.6" opacity="0.5" />
      <circle cx="17" cy="17" r="9" stroke={ring} strokeWidth="1.6" />
      <line x1="17" y1="17" x2="17" y2="3" stroke={ring} strokeWidth="1.8" />
      <circle cx="17" cy="17" r="2" fill="var(--text)" />
    </svg>
  );
}

export function LogoMark({ size = 34 }: { size?: number }) {
  // The cover/colophon mark — amber middle ring on ink.
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-label="Refrain">
      <circle cx="17" cy="17" r="15.5" stroke="var(--text)" strokeWidth="1.4" />
      <circle cx="17" cy="17" r="10" stroke="var(--maestro)" strokeWidth="1.4" />
      <circle cx="17" cy="17" r="4.5" stroke="var(--text)" strokeWidth="1.4" />
      <line x1="17" y1="17" x2="17" y2="2.5" stroke="var(--maestro)" strokeWidth="1.6" />
      <circle cx="17" cy="17" r="1.7" fill="var(--text)" />
    </svg>
  );
}

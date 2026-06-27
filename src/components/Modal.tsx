import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

export function Modal({
  title,
  tag,
  width = 760,
  children,
  footer,
}: {
  title: string;
  tag: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const close = useStore((s) => s.openSurface);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes regardless of which field has focus; move focus into the
  // dialog on open and restore it to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      trigger?.focus?.();
    };
  }, [close]);

  return (
    <div
      onClick={() => close(null)}
      style={{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--bg-deeper) 78%, transparent)', backdropFilter: 'blur(3px)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="refr-settle"
        style={{ width, maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto', outline: 'none', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 13, boxShadow: 'var(--shadow)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--titlebar)', zIndex: 1 }}>
          <span style={{ ...mono, fontSize: 11, letterSpacing: '.14em', color: 'var(--maestro)' }}>{tag}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--text)' }}>{title}</span>
          <button onClick={() => close(null)} style={{ marginLeft: 'auto', ...mono, fontSize: 12, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 6, padding: '4px 9px' }}>
            esc ✕
          </button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        {footer && <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--bg-deep)' }}>{footer}</div>}
      </div>
    </div>
  );
}

import { useStore } from '../state/store';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// A quiet status line — audio policy means the engine can only start after a
// gesture; this surfaces loading / errors without blocking the UI.
export function AudioGate() {
  const status = useStore((s) => s.engineStatus);
  const error = useStore((s) => s.engineError);
  const playing = useStore((s) => s.playing);
  const play = useStore((s) => s.play);

  let content: React.ReactNode = null;
  if (status === 'loading') {
    content = (
      <>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--select)', animation: 'refrPulse 1s ease-in-out infinite' }} />
        warming up Strudel · loading samples…
      </>
    );
  } else if (status === 'error') {
    content = <span style={{ color: 'var(--panic)' }}>audio error: {error ?? 'unknown'} — synth voices may still sound</span>;
  } else if (status === 'ready' && !playing) {
    content = (
      <button onClick={play} style={{ ...mono, fontSize: 11, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 6, padding: '5px 12px', fontWeight: 700 }}>
        ▶ press Space to play
      </button>
    );
  } else {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        ...mono,
        fontSize: 11,
        color: 'var(--text-1)',
        background: 'var(--elev-3)',
        border: '1px solid var(--line-4)',
        borderRadius: 9,
        padding: '7px 13px',
        boxShadow: 'var(--shadow)',
        zIndex: 60,
      }}
    >
      {content}
    </div>
  );
}

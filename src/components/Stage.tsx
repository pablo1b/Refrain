import { useStore } from '../state/store';
import { CycleClock } from './CycleClock';
import { useMeters } from './useMeters';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

export function Stage() {
  const voices = useStore((s) => s.voices);
  const playing = useStore((s) => s.playing);
  const cps = useStore((s) => s.cps);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const toggleMute = useStore((s) => s.toggleMute);
  const anySolo = voices.some((v) => v.solo);
  const levels = useMeters(voices.map((v) => v.id), playing);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0,1fr)', borderTop: '1px solid var(--line)', background: 'var(--bg-deep)', flex: 'none', height: 168 }}>
      <div style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--line-3)' }}>
        <CycleClock size={130} />
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...mono, fontSize: 10, letterSpacing: '.16em', color: 'var(--text-dim)' }}>THE STAGE — {voices.length} VOICES</span>
          <span style={{ ...mono, fontSize: 10, color: 'var(--text-dim)' }}>{cps} cps · {playing ? '−6.2 dB' : 'idle'}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto' }}>
          {voices.map((v) => {
            const dimmed = v.muted || (anySolo && !v.solo);
            const level = dimmed ? 0 : (levels[v.id] ?? 0) * 100;
            return (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, ...mono, fontSize: 11 }}>
                <span style={{ width: 54, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.sigil}</span>
                <div
                  role="meter"
                  aria-label={`${v.sigil} level`}
                  aria-valuenow={Math.round(level)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--elev)', overflow: 'hidden' }}
                >
                  <div style={{ width: `${level}%`, height: '100%', background: v.color, transition: 'width .12s linear' }} />
                </div>
                <span style={{ width: 30, textAlign: 'right', color: 'var(--text-dim)' }}>{Math.round(level)}%</span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => toggleSolo(v.id)} style={metaBtn(v.solo, 'var(--live)')}>S</button>
                  <button onClick={() => toggleMute(v.id)} style={metaBtn(v.muted, 'var(--panic)')}>M</button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function metaBtn(on: boolean, color: string): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 9.5,
    width: 16,
    height: 15,
    lineHeight: 1,
    borderRadius: 3,
    fontWeight: 700,
    color: on ? 'var(--live-ink)' : 'var(--text-dim)',
    background: on ? color : 'transparent',
    border: `1px solid ${on ? color : 'var(--line-5)'}`,
  };
}

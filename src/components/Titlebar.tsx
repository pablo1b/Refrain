import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { Logo } from './Logo';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

/** Live cycle counter — reads the scheduler each frame, re-renders only on tick. */
function LiveCycle() {
  const [cycle, setCycle] = useState(0);
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setCycle(Math.floor(engine.now()));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span style={{ ...mono, fontSize: 12, color: playing ? 'var(--live)' : 'var(--text-2)' }}>
      cycle {playing ? cycle : '—'}
    </span>
  );
}

export function Titlebar() {
  const playing = useStore((s) => s.playing);
  const cps = useStore((s) => s.cps);
  const togglePlay = useStore((s) => s.togglePlay);
  const panic = useStore((s) => s.panic);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const setMode = useStore((s) => s.setMode);
  const openSurface = useStore((s) => s.openSurface);
  const roles = useStore((s) => s.roles);
  const providers = useStore((s) => s.providers);
  const engineStatus = useStore((s) => s.engineStatus);

  const genRole = roles.find((r) => r.id === 'generation');
  const genProv = providers.find((p) => p.id === genRole?.provider);
  const modelLabel = genProv?.label ? `${genProv.label.replace('Anthropic', 'Claude')} ${capModel(genRole?.model)}` : 'Maestro';
  const bpm = Math.round(cps * 240);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        height: 46,
        padding: '0 14px',
        background: 'var(--titlebar)',
        borderBottom: '1px solid var(--line)',
        flex: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 7 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--line-5)' }} />
        ))}
      </div>
      <span style={{ marginLeft: 6, display: 'flex', alignItems: 'center' }}>
        <Logo size={17} live />
      </span>
      <span style={{ ...mono, fontSize: 12, color: 'var(--text-2)' }}>
        nightjar / <span style={{ color: 'var(--text)' }}>set—02.refrain</span>
      </span>

      {/* transport pill */}
      <div
        style={{
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'var(--elev)',
          border: '1px solid var(--line-4)',
          borderRadius: 8,
          padding: '5px 12px',
        }}
      >
        <button onClick={togglePlay} title={playing ? 'stop (space)' : 'play (space)'} aria-label="play/stop" style={{ display: 'flex', alignItems: 'center', padding: 0 }}>
          {playing ? (
            <span style={{ display: 'flex', gap: 2 }}>
              <span style={{ width: 3, height: 12, background: 'var(--live)' }} />
              <span style={{ width: 3, height: 12, background: 'var(--live)' }} />
            </span>
          ) : (
            <span style={{ width: 0, height: 0, borderLeft: '9px solid var(--live)', borderTop: '6px solid transparent', borderBottom: '6px solid transparent' }} />
          )}
        </button>
        <LiveCycle />
        <Divider />
        <span style={{ ...mono, fontSize: 12, color: 'var(--text)' }}>
          {bpm} <span style={{ color: 'var(--text-3)' }}>bpm</span>
        </span>
        <Divider />
        <span style={{ ...mono, fontSize: 12, color: 'var(--text-2)' }}>cps {cps}</span>
      </div>

      {/* right cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <button
          onClick={() => openSurface('providers')}
          title="providers & routing"
          style={{ display: 'flex', alignItems: 'center', gap: 6, ...mono, fontSize: 11, color: 'var(--text-1)', background: 'var(--elev)', border: '1px solid var(--line-4)', borderRadius: 6, padding: '4px 9px' }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: engineStatus === 'ready' ? 'var(--maestro)' : engineStatus === 'loading' ? 'var(--select)' : 'var(--text-dim)' }} />
          {modelLabel}
        </button>
        <button onClick={toggleTheme} title="toggle theme" style={{ ...mono, fontSize: 11, color: 'var(--text-2)', border: '1px solid var(--line-4)', borderRadius: 6, padding: '4px 8px' }}>
          ◐ theme
        </button>
        <button onClick={() => setMode('performance')} title="performance mode" style={{ ...mono, fontSize: 11, color: 'var(--text-2)', border: '1px solid var(--line-4)', borderRadius: 6, padding: '4px 8px' }}>
          ◰ live
        </button>
        <button onClick={panic} title="panic — hush all (clock safe)" style={{ ...mono, fontSize: 11, color: '#fff', background: 'var(--panic)', borderRadius: 6, padding: '4px 10px', fontWeight: 700 }}>
          PANIC
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 14, background: 'var(--line-5)' }} />;
}

function capModel(m?: string): string {
  if (!m) return '';
  if (/sonnet/i.test(m)) return 'Sonnet';
  if (/haiku/i.test(m)) return 'Haiku';
  if (/opus/i.test(m)) return 'Opus';
  if (/gpt/i.test(m)) return m.toUpperCase();
  if (/gemini/i.test(m)) return 'Gemini';
  if (/llama/i.test(m)) return 'Llama';
  return m;
}

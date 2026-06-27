import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { CycleClock } from './CycleClock';
import { useMeters } from './useMeters';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

function LiveReadout({ cps }: { cps: number }) {
  const [cycle, setCycle] = useState(0);
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
    <>
      <div style={{ position: 'absolute', top: 22, left: 24, ...mono, fontSize: 13, color: 'var(--live)' }}>cycle {cycle}</div>
      <div style={{ position: 'absolute', top: 22, right: 24, ...mono, fontSize: 13, color: 'var(--text-2)' }}>{Math.round(cps * 240)} bpm</div>
    </>
  );
}

export function PerformanceMode() {
  const voices = useStore((s) => s.voices);
  const scenes = useStore((s) => s.scenes);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const cps = useStore((s) => s.cps);
  const playing = useStore((s) => s.playing);
  const setMode = useStore((s) => s.setMode);
  const launch = useStore((s) => s.launchScene);
  const snapshot = useStore((s) => s.snapshotScene);
  const panic = useStore((s) => s.panic);
  const hush = useStore((s) => s.hush);
  const anySolo = voices.some((v) => v.solo);
  const levels = useMeters(voices.map((v) => v.id), playing);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('studio');
      if (e.key === ' ') {
        e.preventDefault();
        useStore.getState().togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode]);

  const launchers = scenes.length ? scenes.map((s) => ({ id: s.id, name: s.name })) : ['intro', 'build', 'drop', 'break', 'outro'].map((n) => ({ id: '', name: n }));

  return (
    <div style={{ height: '100vh', background: 'var(--bg-deeper)', display: 'flex', flexDirection: 'column', color: 'var(--text)' }}>
      <button onClick={() => setMode('studio')} style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', ...mono, fontSize: 11, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 6, padding: '4px 12px', zIndex: 2 }}>
        esc · exit live
      </button>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr', gridTemplateRows: 'minmax(0, 1fr)', minHeight: 0, overflow: 'hidden' }}>
        {/* left column scrolls if voices overflow; meters stay pinned to the bottom */}
        {/* left: live voices + meters */}
        <div style={{ borderRight: '1px solid var(--line-3)', padding: '22px 18px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0, overflowY: 'auto' }}>
          <span style={{ ...mono, fontSize: 10, letterSpacing: '.2em', color: 'var(--text-dim)' }}>LIVE</span>
          <div style={{ ...mono, fontSize: 12, lineHeight: 2, color: 'var(--text-2)' }}>
            {voices.map((v) => {
              const dim = v.muted || (anySolo && !v.solo);
              return (
                <div key={v.id}>
                  <span style={{ color: 'var(--c-voice)' }}>{v.sigil}</span>{' '}
                  <span style={{ color: dim ? 'var(--text-dim)' : v.color }}>{dim ? '○' : '●'}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {voices.slice(0, 6).map((v) => {
              const dim = v.muted || (anySolo && !v.solo);
              const level = dim ? 0 : (levels[v.id] ?? 0) * 100;
              return (
                <div
                  key={v.id}
                  role="meter"
                  aria-label={`${v.sigil} level`}
                  aria-valuenow={Math.round(level)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  style={{ height: 4, borderRadius: 2, background: 'var(--line-3)', overflow: 'hidden' }}
                >
                  <div style={{ width: `${level}%`, height: '100%', background: v.color, transition: 'width .12s linear' }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* center: the clock fills the screen */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <LiveReadout cps={cps} />
          <CycleClock size={Math.min(440, window.innerHeight - 240)} strong />
        </div>
      </div>

      {/* scene launchers + panic */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, borderTop: '1px solid var(--line-3)', background: 'var(--bg-deep)', flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 11, color: 'var(--text-dim)', paddingRight: 4 }}>SCENES</span>
        {launchers.map((l, i) => {
          const active = l.id && l.id === activeSceneId;
          return (
            <button
              key={l.id || l.name}
              onClick={() => (l.id ? launch(l.id) : snapshot(l.name))}
              style={{ ...mono, fontSize: 13, color: active ? 'var(--live-ink)' : 'var(--text-2)', background: active ? 'var(--live)' : 'transparent', border: active ? 'none' : '1px solid var(--line-5)', borderRadius: 7, padding: '8px 16px', fontWeight: active ? 700 : 400 }}
            >
              {l.name}
            </button>
          );
        })}
        <span style={{ marginLeft: 'auto', ...mono, fontSize: 10, color: 'var(--text-dim)' }}>◎ MIDI mappable</span>
        <button onClick={hush} style={{ ...mono, fontSize: 13, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--hush)', borderRadius: 7, padding: '8px 16px' }}>
          HUSH
        </button>
        <button onClick={panic} style={{ ...mono, fontSize: 13, fontWeight: 700, color: '#fff', background: 'var(--panic)', borderRadius: 7, padding: '8px 18px' }}>
          PANIC
        </button>
      </div>
    </div>
  );
}

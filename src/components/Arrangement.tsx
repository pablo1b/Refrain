import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const QUICK = ['intro', 'build', 'drop', 'break', 'outro'];

export function Arrangement() {
  const voices = useStore((s) => s.voices);
  const scenes = useStore((s) => s.scenes);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const snapshot = useStore((s) => s.snapshotScene);
  const launch = useStore((s) => s.launchScene);
  const del = useStore((s) => s.deleteScene);
  const send = useStore((s) => s.sendMaestro);
  const openSurface = useStore((s) => s.openSurface);
  const [name, setName] = useState('');

  const askTransition = () => {
    openSurface(null);
    send('three ways into the drop — a riser and a filter sweep');
  };

  const cols = `92px repeat(${Math.max(scenes.length, 1)}, minmax(64px, 1fr))`;

  return (
    <Modal tag="7.6 — ARRANGEMENT" title="Scenes on a timeline" width={860}>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: '64ch', margin: '0 0 20px' }}>
        Lay named scenes on a timeline — each a snapshot of which voices play. Capture the current mix as a scene, then click any
        scene to launch it into the running transport. In Performance mode these same scenes become launch buttons.
      </p>

      {scenes.length === 0 ? (
        <div style={{ border: '1px dashed var(--line-5)', borderRadius: 10, padding: 28, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
          No scenes yet. Solo/mute voices to taste, then capture — or use a quick name below.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          {/* header */}
          <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid var(--line)', ...mono, fontSize: 10.5 }}>
            <div style={{ padding: '9px 10px', color: 'var(--text-dim)', borderRight: '1px solid var(--line-3)' }}>VOICE</div>
            {scenes.map((sc) => (
              <div
                key={sc.id}
                onClick={() => launch(sc.id)}
                title="launch scene"
                style={{ padding: '9px 8px', textAlign: 'center', cursor: 'pointer', color: sc.id === activeSceneId ? 'var(--live-ink)' : 'var(--text-1)', background: sc.id === activeSceneId ? 'var(--live)' : 'transparent', fontWeight: sc.id === activeSceneId ? 700 : 400, borderRight: '1px solid var(--line-3)', position: 'relative' }}
              >
                {sc.name} {sc.id === activeSceneId ? '▸' : ''}
                <button aria-label={`delete scene ${sc.name}`} title="delete scene" onClick={(e) => { e.stopPropagation(); del(sc.id); }} style={{ position: 'absolute', top: 2, right: 4, fontSize: 9, color: 'inherit', opacity: 0.5 }}>✕</button>
              </div>
            ))}
          </div>
          {/* rows */}
          {voices.map((v) => (
            <div key={v.id} style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid var(--line-3)' }}>
              <div style={{ padding: '8px 10px', ...mono, fontSize: 10.5, color: v.color, borderRight: '1px solid var(--line-3)' }}>{v.id}</div>
              {scenes.map((sc) => {
                const lvl = sc.levels[v.id] ?? 0;
                return (
                  <div key={sc.id} style={{ borderRight: '1px solid var(--line-3)', padding: '5px 6px' }}>
                    {lvl > 0 && <div style={{ height: 14, borderRadius: 3, background: v.color, opacity: 0.35 + lvl * 0.55 }} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* capture row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { snapshot(name.trim()); setName(''); } }}
          placeholder="scene name…"
          style={{ ...mono, fontSize: 12, color: 'var(--text)', background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 7, padding: '7px 11px', outline: 'none', width: 160 }}
        />
        <button onClick={() => { snapshot(name.trim()); setName(''); }} style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 7, padding: '7px 13px' }}>
          + capture current mix
        </button>
        <span style={{ ...mono, fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>quick:</span>
        {QUICK.map((q) => (
          <button key={q} onClick={() => snapshot(q)} style={{ ...mono, fontSize: 11, color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 7, padding: '6px 11px' }}>
            {q}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, padding: '11px 14px', borderRadius: 9, background: 'var(--maestro-bubble)', border: '1px solid var(--maestro-bubble-line)' }}>
        <span style={{ ...mono, fontSize: 11, color: 'var(--maestro)' }}>⤳ transition</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-1)', flex: 1 }}>
          Have the Maestro write a <em>build → drop</em> transition — a riser + filter sweep — as parked lanes you can audition and commit.
        </span>
        <button onClick={askTransition} style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--maestro)', borderRadius: 6, padding: '6px 12px', flex: 'none' }}>
          ask the Maestro
        </button>
      </div>
    </Modal>
  );
}

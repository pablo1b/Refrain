import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { highlightStrudel } from './Code';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
type Tab = 'GENERATE' | 'SEARCH PACKS' | 'UPLOAD';

export function SampleFoundry() {
  const stageEdit = useStore((s) => s.stageEdit);
  const score = useStore((s) => s.score);
  const close = useStore((s) => s.openSurface);
  const [tab, setTab] = useState<Tab>('GENERATE');
  const [desc, setDesc] = useState('a dusty Rhodes chord in F minor, tape-saturated');
  const [rendered, setRendered] = useState(false);

  const snippet = `s("casio").n("0 1 2 3")`;

  const add = () => {
    stageEdit(`Foundry — sliced **${desc.split(',')[0]}** into a 4-step \`n\`-map, added as ${'`$smp`'}.`, `${score}\n\n$smp: s("casio").n("0 1 2 3").gain(0.7)`, { directive: 'foundry' });
    close(null);
  };

  return (
    <Modal tag="7.4 — SAMPLE FOUNDRY" title="Generate, find, and chop sound" width={760}>
      <div style={{ display: 'flex', gap: 18, ...mono, fontSize: 11, borderBottom: '1px solid var(--line)', marginBottom: 18 }}>
        {(['GENERATE', 'SEARCH PACKS', 'UPLOAD'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '0 0 11px', color: tab === t ? 'var(--text)' : 'var(--text-3)', borderBottom: tab === t ? '2px solid var(--live)' : '2px solid transparent' }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 8, padding: '10px 13px', marginBottom: 16 }}>
        <span style={{ color: 'var(--maestro)' }}>↗</span>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={tab === 'SEARCH PACKS' ? 'search your packs by sound…' : tab === 'UPLOAD' ? 'drop a file…' : 'describe a sound…'}
          style={{ flex: 1, fontSize: 13, color: 'var(--text-1)', background: 'transparent', border: 'none', outline: 'none' }}
        />
        <button onClick={() => setRendered(true)} style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 6, padding: '5px 12px' }}>
          {tab === 'GENERATE' ? 'render' : tab === 'SEARCH PACKS' ? 'search' : 'pick'}
        </button>
      </div>

      {/* waveform + slices */}
      <div style={{ position: 'relative', background: 'var(--bg-deep)', border: '1px solid var(--line)', borderRadius: 8, padding: '18px 14px', marginBottom: 14, opacity: rendered ? 1 : 0.4 }}>
        <svg width="100%" height="58" viewBox="0 0 600 58" preserveAspectRatio="none">
          <g stroke="var(--voice-pad)" strokeWidth="1.4">
            {Array.from({ length: 40 }).map((_, i) => {
              const x = 12 + i * 14.6;
              const h = 4 + (Math.abs(Math.sin(i * 1.7)) * 24 + (i % 5) * 2);
              return <line key={i} x1={x} y1={29 - h} x2={x} y2={29 + h} />;
            })}
          </g>
          {[150, 310, 450].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="58" stroke="var(--maestro)" strokeWidth="1" strokeDasharray="3 3" />
          ))}
        </svg>
        <div style={{ display: 'flex', marginTop: 8, ...mono, fontSize: 9.5, color: 'var(--text-dim)' }}>
          {['n0', 'n1', 'n2', 'n3'].map((n) => (
            <span key={n} style={{ flex: 1 }}>{n}</span>
          ))}
        </div>
        <span style={{ position: 'absolute', top: 8, right: 12, ...mono, fontSize: 10, color: 'var(--maestro)' }}>{rendered ? 'auto-sliced · 4' : 'awaiting render'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <pre style={{ flex: 1, ...mono, fontSize: 11, lineHeight: 1.6, color: 'var(--text-2)', background: 'var(--bg-deep)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', margin: 0, whiteSpace: 'pre-wrap' }}>
          <span style={{ color: 'var(--c-comment)' }}>// inserted at cursor → </span>
          {highlightStrudel(snippet)}
        </pre>
        <button onClick={add} disabled={!rendered} style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--live-ink)', background: rendered ? 'var(--maestro)' : 'var(--line-5)', borderRadius: 6, padding: '8px 14px', opacity: rendered ? 1 : 0.6 }}>
          add to Shelf
        </button>
      </div>
    </Modal>
  );
}

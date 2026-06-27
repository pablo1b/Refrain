import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { highlightStrudel } from './Code';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

function Knob({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  // 0..1 → rotation −135°..+135°
  const angle = -135 + value * 270;
  const onPointerDown = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const startV = value;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dv = (startY - ev.clientY) / 140;
      onChange(Math.max(0, Math.min(1, startV + dv)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div style={{ textAlign: 'center', cursor: 'ns-resize' }} onPointerDown={onPointerDown}>
      <svg width="48" height="48" viewBox="0 0 46 46">
        <circle cx="23" cy="23" r="18" stroke="var(--line-5)" strokeWidth="3" fill="none" />
        <line x1="23" y1="23" x2="23" y2="7" stroke="var(--live)" strokeWidth="2.4" transform={`rotate(${angle} 23 23)`} />
      </svg>
      <div style={{ ...mono, fontSize: 9.5, color: 'var(--text-2)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

const Node = ({ kind, line1, line2, accent }: { kind: string; line1: string; line2: string; accent: string }) => (
  <div style={{ flex: 'none', width: 96, textAlign: 'center', border: `1px solid ${accent === 'var(--maestro)' ? 'var(--maestro-bubble-line)' : 'var(--line-5)'}`, borderRadius: 8, padding: '11px 6px', background: 'var(--elev-2)' }}>
    <div style={{ ...mono, fontSize: 11, color: accent }}>{kind}</div>
    <div style={{ fontSize: 11, color: 'var(--text-1)', marginTop: 3 }}>{line1}</div>
    <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{line2}</div>
  </div>
);

export function PatchDesigner() {
  const stageEdit = useStore((s) => s.stageEdit);
  const score = useStore((s) => s.score);
  const close = useStore((s) => s.openSurface);
  const [cutoff, setCutoff] = useState(0.5);
  const [res, setRes] = useState(0.35);
  const [release, setRelease] = useState(0.7);

  const hz = Math.round(200 + cutoff * 4800);
  const q = +(2 + res * 14).toFixed(1);
  const rel = +(0.2 + release * 4).toFixed(2);
  const chain = `note(x).s("sawtooth")\n .unison(2).detune(0.12)\n .lpf(${hz}).lpq(${q})\n .release(${rel}).room(0.3)`;

  const addVoice = () => {
    const voice = `$warmpad: note("<Cm7 Abmaj7>").s("sawtooth").unison(2).detune(0.12)\n         .lpf(${hz}).lpq(${q}).release(${rel}).room(0.3).slow(2).gain(0.5)`;
    stageEdit(`Patch **~warm·pad** → new voice ${'`$warmpad`'}: lpf ${hz}, lpq ${q}, release ${rel}.`, `${score}\n\n${voice}`, { directive: 'patch' });
    close(null);
  };

  return (
    <Modal tag="7.3 — PATCH DESIGNER" title="Design a synth voice as a signal chain" width={780}>
      <div style={{ ...mono, fontSize: 11, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ color: 'var(--voice-pad)' }}>~ warm·pad</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--live)' }}>
          <span style={{ width: 0, height: 0, borderLeft: '7px solid var(--live)', borderTop: '4px solid transparent', borderBottom: '4px solid transparent' }} />
          turn a knob to hear it
        </span>
      </div>

      {/* node chain */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '8px 0 22px', overflowX: 'auto' }}>
        <Node kind="OSC" line1="2× saw" line2="detune 12c" accent="var(--c-func)" />
        <Wire />
        <Node kind="FILTER" line1={`LP ${q}q`} line2={`cut ${hz}`} accent="var(--c-num)" />
        <Wire />
        <Node kind="ENV" line1={`R ${rel}`} line2="long tail" accent="var(--c-string)" />
        <Wire />
        <Node kind="FX +" line1="room .3" line2="+ chorus" accent="var(--maestro)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 0, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '18px', display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          <Knob label="CUTOFF" value={cutoff} onChange={setCutoff} />
          <Knob label="RES" value={res} onChange={setRes} />
          <Knob label="RELEASE" value={release} onChange={setRelease} />
        </div>
        <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-deep)', padding: '14px 16px' }}>
          <pre style={{ ...mono, fontSize: 11, lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>
            <span style={{ color: 'var(--c-comment)' }}>// ~ warm·pad</span>
            {'\n'}
            {highlightStrudel(chain)}
          </pre>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <input placeholder="“warmer, more analog, longer tail”…" style={{ flex: 1, ...mono, fontSize: 12, color: 'var(--text-1)', background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 7, padding: '8px 11px', outline: 'none' }} />
        <button onClick={addVoice} style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--maestro)', borderRadius: 7, padding: '8px 14px' }}>
          stage as $warmpad
        </button>
      </div>
    </Modal>
  );
}

const Wire = () => <div style={{ flex: 'none', width: 26, height: 1, background: 'var(--line-6)' }} />;

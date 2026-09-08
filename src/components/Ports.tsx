import { useEffect, useReducer } from 'react';
import { useStore } from '../state/store';
import { midi } from '../audio/midiSync';
import { Modal } from './Modal';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// ---------------------------------------------------------------------------
// MIDI & OSC out — the Cycle as sync master (spec §12.7). The rule is simple:
// the Cycle is always the master. Refrain SENDS 24-PPQN clock + transport locked
// to setcps; it does not chase an external clock. This browser tier ships the
// MIDI half over the Web MIDI API; OSC bundles and Ableton Link need a bridge /
// native peer and are honestly marked as desktop-shell tier.
// ---------------------------------------------------------------------------

const SYNC_MAP: { port: string; carries: string; target: string; live: boolean }[] = [
  { port: 'MIDI clock', carries: '24 PPQN + start / stop / continue, locked to setcps', target: 'drum machines, DAWs', live: true },
  { port: 'MIDI notes', carries: 'a pitched voice routed to a channel — $bass.midi(1)', target: 'synths, Eurorack', live: false },
  { port: 'OSC', carries: 'full event bundles — sample, gain, effects, timing', target: 'SuperDirt, Tidal', live: false },
  { port: 'Ableton Link', carries: 'phase + tempo to a shared session (peer, master-lean)', target: 'a room of laptops', live: false },
];

export function Ports() {
  const midiOn = useStore((s) => s.midiOn);
  const toggleMidi = useStore((s) => s.toggleMidi);
  const [, force] = useReducer((n) => n + 1, 0);

  // re-render when devices connect / disconnect (statechange) while open
  useEffect(() => {
    midi.onChange = () => force();
    return () => {
      midi.onChange = null;
    };
  }, []);

  const ports = midiOn ? midi.ports() : [];

  return (
    <Modal tag="12.7 — SYNC OUT" title="The Cycle as sync master" width={760}>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: '66ch', margin: '0 0 18px' }}>
        Refrain <strong>sends</strong>; it never chases an external clock — one authority, no drift. HUSH and PANIC propagate
        outward: PANIC sends all-notes-off on every channel so the emergency exit reaches the whole rig.
      </p>

      {/* MIDI enable + live ports */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 11, overflow: 'hidden', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-deep)' }}>
          <span style={{ ...mono, fontSize: 11, color: 'var(--text-1)' }}>◎ MIDI OUTPUTS</span>
          <button
            onClick={() => toggleMidi()}
            style={{ marginLeft: 'auto', ...mono, fontSize: 10.5, fontWeight: 700, color: midiOn ? 'var(--live-ink)' : 'var(--text-1)', background: midiOn ? 'var(--live)' : 'transparent', border: `1px solid ${midiOn ? 'var(--live)' : 'var(--line-5)'}`, borderRadius: 6, padding: '5px 12px' }}
          >
            {midiOn ? 'sending clock' : 'enable MIDI'}
          </button>
        </div>
        <div style={{ padding: '10px 14px' }}>
          {!midi.supported && (
            <div style={{ ...mono, fontSize: 11.5, color: 'var(--maestro)' }}>Web MIDI isn’t available in this browser — Chromium only. (The desktop shell carries it everywhere.)</div>
          )}
          {midi.supported && !midiOn && (
            <div style={{ ...mono, fontSize: 11.5, color: 'var(--text-2)' }}>Enable to grant MIDI access and start driving external gear from the Cycle.</div>
          )}
          {midiOn && ports.length === 0 && (
            <div style={{ ...mono, fontSize: 11.5, color: 'var(--text-dim)' }}>No MIDI outputs found — connect a device or a virtual port.</div>
          )}
          {midiOn &&
            ports.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line-3)' }}>
                <button
                  onClick={() => midi.setPortEnabled(p.id, !p.enabled)}
                  style={{ ...mono, fontSize: 9.5, fontWeight: 700, color: p.enabled ? 'var(--live-ink)' : 'var(--text-dim)', background: p.enabled ? 'var(--live)' : 'transparent', border: `1px solid ${p.enabled ? 'var(--live)' : 'var(--line-5)'}`, borderRadius: 4, padding: '3px 8px', flex: 'none' }}
                >
                  {p.enabled ? 'clock ▸' : 'off'}
                </button>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                <label style={{ ...mono, fontSize: 10, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 7, flex: 'none' }}>
                  latency
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={p.latencyMs}
                    onChange={(e) => midi.setPortLatency(p.id, Number(e.target.value))}
                    style={{ width: 90 }}
                  />
                  <span style={{ width: 42, textAlign: 'right', color: p.latencyMs ? 'var(--maestro)' : 'var(--text-dim)' }}>{p.latencyMs > 0 ? '+' : ''}{p.latencyMs} ms</span>
                </label>
              </div>
            ))}
          {midiOn && ports.some((p) => p.latencyMs < 0) && (
            <div style={{ ...mono, fontSize: 9.5, color: 'var(--text-dim)', marginTop: 8 }}>Negative offsets are clamped in the browser tier (can’t send in the past); the desktop shell look-ahead honours them fully.</div>
          )}
        </div>
      </div>

      {/* the sync-out map */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 11, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 0.9fr', background: 'var(--bg-deep)', borderBottom: '1px solid var(--line)', ...mono, fontSize: 10, letterSpacing: '.08em', color: 'var(--maestro)' }}>
          <div style={{ padding: '10px 14px' }}>PORT</div>
          <div style={{ padding: '10px 14px' }}>CARRIES</div>
          <div style={{ padding: '10px 14px' }}>TARGET</div>
        </div>
        {SYNC_MAP.map((r) => (
          <div key={r.port} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 0.9fr', borderBottom: '1px solid var(--line-3)', fontSize: 12, alignItems: 'center' }}>
            <div style={{ padding: '10px 14px', color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.live ? 'var(--live)' : 'var(--text-dim)', flex: 'none' }} />
              {r.port}
            </div>
            <div style={{ padding: '10px 14px', color: 'var(--text-2)' }}>{r.carries}</div>
            <div style={{ padding: '10px 14px', ...mono, fontSize: 10.5, color: r.live ? 'var(--text-2)' : 'var(--text-dim)' }}>{r.live ? r.target : 'desktop shell'}</div>
          </div>
        ))}
      </div>
      <p style={{ ...mono, fontSize: 10.5, color: 'var(--text-dim)', margin: '12px 2px 0' }}>
        Routing is a per-voice method (<span style={{ color: 'var(--maestro)' }}>.midi()</span> / <span style={{ color: 'var(--maestro)' }}>.osc()</span>) so it lives in the score like everything else. MIDI clock is live here; note/OSC/Link routing ships with the desktop shell.
      </p>
    </Modal>
  );
}

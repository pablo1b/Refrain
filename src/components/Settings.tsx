import { useStore, transportKeyLabel } from '../state/store';
import { Modal } from './Modal';
import type { TransportKey, MotionPref } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// ---------------------------------------------------------------------------
// Settings — Keymap (spec §12.3) + Accessibility (spec §12.8). The transport
// binding is remappable; the browser tier defaults to ⌘⇧⏎ (never browser-
// reserved) with F5 an opt-in alias that overrides reload. Reduced motion has a
// manual override that beats the OS setting in either direction.
// ---------------------------------------------------------------------------

// The fixed bindings, shown read-only for reference; the transport row reads the
// ACTIVE key so the UI never tells you to press a key that does nothing.
const FIXED: [string, string][] = [
  ['⌘⏎', 'Evaluate / re-audition'],
  ['Tab', 'Indent · ⇧Tab dedent'],
  ['⌃Space', 'Trigger completion'],
  ['⌘K', 'Ask the Maestro inline'],
  ['click №', 'Pin a line / range (drag · ⇧ · ⌘)'],
  ['Esc', 'Clear selection & all pins'],
  ['⌘P', 'Command palette'],
  ['⌘O', 'Open project · ⌘S checkpoint'],
  ['⌥Z', 'Rewind one commit'],
  ['⌥.', 'Quiet the Prompter'],
  ['⌘.', 'PANIC — cut to silence'],
];

export function Settings() {
  const transportKey = useStore((s) => s.transportKey);
  const setTransportKey = useStore((s) => s.setTransportKey);
  const motion = useStore((s) => s.motion);
  const setMotion = useStore((s) => s.setMotion);
  const openSurface = useStore((s) => s.openSurface);

  return (
    <Modal tag="SETTINGS" title="Keymap & Accessibility" width={720}>
      {/* ---- Keymap ---- */}
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Transport key</h3>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)', maxWidth: '64ch', margin: '0 0 14px' }}>
        In the browser tier F5 is the reload key, so the default transport is <span style={{ ...mono, background: 'var(--bg-deep)', padding: '1px 6px', borderRadius: 4 }}>⌘⇧⏎</span> — never browser-reserved. F5 is offered as an opt-in alias that overrides reload.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
        <TransportChoice value="mod-shift-enter" active={transportKey} label="⌘⇧⏎" sub="default · safe" onPick={setTransportKey} />
        <TransportChoice value="f5" active={transportKey} label="F5" sub="opt-in · overrides reload" onPick={setTransportKey} />
      </div>
      {transportKey === 'f5' && (
        <p style={{ ...mono, fontSize: 10.5, color: 'var(--maestro)', margin: '0 0 14px' }}>
          ⚠ F5 now plays/pauses — a mis-timed press with focus outside the editor could still reach the browser before the app catches it.
        </p>
      )}

      <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', borderBottom: '1px solid var(--line-3)', background: 'var(--bg-deep)' }}>
          <Key>{transportKeyLabel(transportKey)}</Key>
          <span style={{ fontSize: 13, color: 'var(--text-1)' }}>Play / pause the transport <span style={{ color: 'var(--live)', ...mono, fontSize: 10 }}>· active</span></span>
        </div>
        {FIXED.map(([k, desc]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 14px', borderBottom: '1px solid var(--line-3)' }}>
            <Key>{k}</Key>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{desc}</span>
          </div>
        ))}
      </div>

      {/* ---- Accessibility ---- */}
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Reduced motion</h3>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)', maxWidth: '64ch', margin: '0 0 14px' }}>
        Motion that carries information stays as a discrete step; decorative motion stops. A playhead is data — under reduced motion it steps once per 1/16 instead of sweeping. This overrides the OS setting either way.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
        <MotionChoice value="system" active={motion} label="Match system" onPick={setMotion} />
        <MotionChoice value="full" active={motion} label="Full motion" onPick={setMotion} />
        <MotionChoice value="reduced" active={motion} label="Reduced" onPick={setMotion} />
      </div>

      {/* ---- Sync-out link ---- */}
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--line-3)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Drive external gear from the Cycle</span>
        <button onClick={() => openSurface('ports')} style={{ marginLeft: 'auto', ...mono, fontSize: 11, color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 6, padding: '5px 11px' }}>
          ◎ MIDI / OSC ports →
        </button>
      </div>
    </Modal>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ ...mono, fontSize: 12, color: 'var(--text-1)', background: 'var(--bg-deep)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '3px 9px', minWidth: 74, textAlign: 'center', flex: 'none' }}>
      {children}
    </span>
  );
}

function TransportChoice({ value, active, label, sub, onPick }: { value: TransportKey; active: TransportKey; label: string; sub: string; onPick: (v: TransportKey) => void }) {
  const on = value === active;
  return (
    <button onClick={() => onPick(value)} style={{ flex: 1, textAlign: 'left', border: `1px solid ${on ? 'var(--live)' : 'var(--line-5)'}`, background: on ? 'color-mix(in srgb, var(--live) 10%, transparent)' : 'transparent', borderRadius: 9, padding: '11px 13px' }}>
      <div style={{ ...mono, fontSize: 14, color: on ? 'var(--live)' : 'var(--text-1)', fontWeight: 700 }}>{label}</div>
      <div style={{ ...mono, fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>{sub}</div>
    </button>
  );
}

function MotionChoice({ value, active, label, onPick }: { value: MotionPref; active: MotionPref; label: string; onPick: (v: MotionPref) => void }) {
  const on = value === active;
  return (
    <button onClick={() => onPick(value)} style={{ flex: 1, ...mono, fontSize: 12, color: on ? 'var(--live-ink)' : 'var(--text-1)', background: on ? 'var(--live)' : 'transparent', border: `1px solid ${on ? 'var(--live)' : 'var(--line-5)'}`, borderRadius: 8, padding: '9px 12px', fontWeight: on ? 700 : 400 }}>
      {label}
    </button>
  );
}

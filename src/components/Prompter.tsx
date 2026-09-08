import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { highlightStrudel } from './Code';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// ---------------------------------------------------------------------------
// The Prompter (spec §04). The Maestro acts when asked; the Prompter only ever
// OFFERS. It watches the parsed tree and surfaces small, bounded musical
// observations — a static voice, a register clash, a sparse bar — as at most
// three cards. `try` opens the suggestion as a Maestro turn; dismiss learns the
// "no" for the session; ⌥. mutes it entirely. Never on the critical path:
// debounced to score/tree changes, and it simply goes quiet when there's
// nothing worth a glance.
// ---------------------------------------------------------------------------

export function Prompter() {
  const cards = useStore((s) => s.prompterCards);
  const muted = useStore((s) => s.prompterMuted);
  const voices = useStore((s) => s.voices);
  const refresh = useStore((s) => s.refreshPrompter);
  const tryCard = useStore((s) => s.tryCard);
  const dismiss = useStore((s) => s.dismissCard);
  const toggle = useStore((s) => s.togglePrompter);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // debounce observations to score/tree changes — off the critical path (§04)
  useEffect(() => {
    if (muted) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => refresh(), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [voices, muted, refresh]);

  if (muted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderTop: '1px solid var(--line-3)', background: 'var(--bg-deep)' }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '.16em', color: 'var(--text-dim)' }}>PROMPTER</span>
        <span style={{ ...mono, fontSize: 10, color: 'var(--text-3)' }}>quiet</span>
        <button onClick={toggle} style={{ marginLeft: 'auto', ...mono, fontSize: 10, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '3px 8px' }}>⌥. resume</button>
      </div>
    );
  }
  if (cards.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--line-3)', background: 'var(--bg-deep)', padding: '9px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '.16em', color: 'var(--text-dim)' }}>PROMPTER</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...mono, fontSize: 9.5, color: 'var(--text-2)', border: '1px solid var(--line-4)', borderRadius: 5, padding: '2px 7px' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--voice-pad)' }} />offers only
        </span>
        <button onClick={toggle} style={{ marginLeft: 'auto', ...mono, fontSize: 10, color: 'var(--text-dim)' }}>⌥. quiet</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, cards.length)}, 1fr)`, gap: 9 }}>
        {cards.map((c, i) => (
          <div key={c.id} style={{ border: `1px solid ${i === 0 ? 'var(--lane-sel-line)' : 'var(--line-3)'}`, borderRadius: 8, background: i === 0 ? 'var(--lane-sel)' : 'var(--panel)', padding: '10px 11px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 7 }}>
              <span style={{ color: 'var(--live)', fontSize: 11 }}>{c.glyph}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-1)', lineHeight: 1.4 }}>{c.text}</span>
            </div>
            <div style={{ ...mono, fontSize: 10, color: 'var(--text-2)', background: 'var(--bg-deeper)', border: '1px solid var(--line-3)', borderRadius: 5, padding: '5px 7px', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {highlightStrudel(c.code)}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => tryCard(c.id)} style={{ ...mono, fontSize: 9.5, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 4, padding: '4px 9px' }}>try</button>
              <button onClick={() => dismiss(c.id)} style={{ ...mono, fontSize: 9.5, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 4, padding: '4px 9px' }}>dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

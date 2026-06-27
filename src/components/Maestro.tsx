import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { renderRich } from './rich';
import { DirectivePalette, filterDirectives } from './DirectivePalette';
import { VariationLanes } from './VariationLanes';
import type { MaestroMessage } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

export function Maestro() {
  const messages = useStore((s) => s.messages);
  const send = useStore((s) => s.sendMaestro);
  const runDirective = useStore((s) => s.runDirective);
  const busy = useStore((s) => s.maestroBusy);
  const roles = useStore((s) => s.roles);
  const providers = useStore((s) => s.providers);
  const localOnly = useStore((s) => s.localOnly);

  const [input, setInput] = useState('');
  const [hi, setHi] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const paletteOpen = input.startsWith('/');
  const query = paletteOpen ? input.slice(1) : '';
  const matches = paletteOpen ? filterDirectives(query) : [];

  useEffect(() => {
    const focus = () => taRef.current?.focus();
    window.addEventListener('refrain:focus-maestro', focus);
    return () => window.removeEventListener('refrain:focus-maestro', focus);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  // reset the palette highlight whenever the query changes
  useEffect(() => setHi(0), [query]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    if (paletteOpen) {
      if (matches.length) {
        runDirective(matches[Math.min(hi, matches.length - 1)].id);
        setInput('');
        return;
      }
    }
    send(text);
    setInput('');
  };

  const genProv = providers.find((p) => p.id === roles.find((r) => r.id === 'generation')?.provider);
  const modelTag = localOnly ? 'local-only' : genProv?.connected ? `${genProv.label} · routed` : 'offline · directives';

  return (
    <div style={{ borderLeft: '1px solid var(--line-3)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--line-3)' }}>
        <span style={{ ...mono, fontSize: 11, letterSpacing: '.18em', color: 'var(--maestro)' }}>MAESTRO</span>
        <span style={{ marginLeft: 'auto', ...mono, fontSize: 10, color: 'var(--text-dim)' }}>{modelTag}</span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
        {messages.map((m) => (
          <MessageView key={m.id} m={m} />
        ))}
        {busy && (
          <div style={{ ...mono, fontSize: 11, color: 'var(--maestro)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--maestro)', animation: 'refrPulse 1s ease-in-out infinite' }} />
            the Maestro is composing…
          </div>
        )}
      </div>

      <div style={{ position: 'relative', padding: '11px 12px', borderTop: '1px solid var(--line-3)' }}>
        {paletteOpen && (
          <DirectivePalette query={query} highlightId={matches[Math.min(hi, Math.max(matches.length - 1, 0))]?.id} onPick={(d) => { runDirective(d.id); setInput(''); }} />
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 8, padding: '8px 11px' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: '20px' }}>▷</span>
          <textarea
            ref={taRef}
            id="maestro-input"
            name="maestro-input"
            aria-label="Speak music, or slash for directives"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (paletteOpen && matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setHi((h) => (e.key === 'ArrowDown' ? (h + 1) % matches.length : (h - 1 + matches.length) % matches.length));
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                setInput('');
              }
            }}
            rows={1}
            placeholder="Speak music, or / for directives…"
            style={{
              flex: 1,
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: 12.5,
              lineHeight: '20px',
              maxHeight: 96,
              fontFamily: input.startsWith('/') ? 'var(--font-mono)' : 'var(--font-ui)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function MessageView({ m }: { m: MaestroMessage }) {
  if (m.role === 'user') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '88%', background: 'var(--user-bubble)', borderRadius: '9px 9px 2px 9px', padding: '9px 12px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)' }}>
        {m.text}
      </div>
    );
  }

  // maestro turn
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div
        style={{
          maxWidth: m.shape === 'lanes' ? '100%' : '92%',
          background: m.shape === 'error' ? 'color-mix(in srgb, var(--panic) 12%, var(--panel))' : 'var(--maestro-bubble)',
          border: `1px solid ${m.shape === 'error' ? 'var(--panic)' : 'var(--maestro-bubble-line)'}`,
          borderRadius: '9px 9px 9px 2px',
          padding: '10px 12px',
          fontSize: 12.5,
          lineHeight: 1.55,
          color: 'var(--text-1)',
        }}
      >
        {m.shape === 'thinking' ? <span style={{ color: 'var(--text-dim)' }}>…</span> : renderRich(m.text)}
      </div>
      {m.shape === 'diff' && m.editId && <DiffActions editId={m.editId} />}
      {m.shape === 'lanes' && m.laneSetId && <VariationLanes laneSetId={m.laneSetId} />}
    </div>
  );
}

function DiffActions({ editId }: { editId: string }) {
  const staged = useStore((s) => s.stagedEdit);
  const accept = useStore((s) => s.acceptEdit);
  const reject = useStore((s) => s.rejectEdit);
  const isLive = staged?.id === editId;
  if (!isLive) {
    return <div style={{ ...mono, fontSize: 10.5, color: 'var(--text-dim)' }}>— resolved —</div>;
  }
  return (
    <div style={{ display: 'flex', gap: 7 }}>
      <button onClick={accept} style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 5, padding: '5px 11px' }}>
        Accept ⏎
      </button>
      <button onClick={reject} style={{ ...mono, fontSize: 10.5, color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '5px 11px' }}>
        Reject
      </button>
      <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '5px 9px' }}>▣ diff</span>
    </div>
  );
}

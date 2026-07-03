import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { renderRich } from './rich';
import { DirectivePalette, filterPalette, type PaletteItem } from './DirectivePalette';
import { VariationLanes } from './VariationLanes';
import type { MaestroMessage, PlanStep, ToolCall } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

export function Maestro() {
  const messages = useStore((s) => s.messages);
  const send = useStore((s) => s.sendMaestro);
  const runDirective = useStore((s) => s.runDirective);
  const busy = useStore((s) => s.maestroBusy);
  const roles = useStore((s) => s.roles);
  const providers = useStore((s) => s.providers);
  const localOnly = useStore((s) => s.localOnly);
  const thinking = useStore((s) => s.maestroThinking);
  const toggleThinking = useStore((s) => s.toggleThinking);
  const custom = useStore((s) => s.customDirectives);
  const voices = useStore((s) => s.voices);
  const scenes = useStore((s) => s.scenes);

  const [input, setInput] = useState('');
  const [hi, setHi] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const paletteOpen = input.startsWith('/');
  const query = paletteOpen ? input.slice(1) : '';
  const matches = paletteOpen ? filterPalette(query, custom) : [];

  // @-mention: the trailing @token being typed
  const atMatch = input.match(/(?:^|\s)@(\w*)$/);
  const atOpen = !!atMatch && !paletteOpen;
  const atQuery = atMatch?.[1]?.toLowerCase() ?? '';
  const mentionOpts = atOpen ? buildMentions(voices, scenes, atQuery) : [];

  useEffect(() => {
    const focus = () => taRef.current?.focus();
    const palette = () => { setInput('/'); taRef.current?.focus(); };
    window.addEventListener('refrain:focus-maestro', focus);
    window.addEventListener('refrain:command-palette', palette);
    return () => {
      window.removeEventListener('refrain:focus-maestro', focus);
      window.removeEventListener('refrain:command-palette', palette);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  useEffect(() => setHi(0), [query, atQuery]);

  const pick = (item: PaletteItem) => {
    if (item.kind === 'command') send('/' + item.id);
    else runDirective(item.id);
    setInput('');
  };

  const pickMention = (m: MentionOpt) => {
    setInput((prev) => prev.replace(/@\w*$/, `@${m.token} `));
    taRef.current?.focus();
  };

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    if (paletteOpen && matches.length) {
      pick(matches[Math.min(hi, matches.length - 1)]);
      return;
    }
    send(text);
    setInput('');
  };

  const genProv = providers.find((p) => p.id === roles.find((r) => r.id === 'generation')?.provider);
  const modelTag = localOnly ? 'local-only' : genProv?.connected ? `${genProv.label.replace('Anthropic', 'Claude')}` : 'offline · directives';

  return (
    <div style={{ borderLeft: '1px solid var(--line-3)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line-3)' }}>
        <span style={{ ...mono, fontSize: 11, letterSpacing: '.18em', color: 'var(--maestro)' }}>MAESTRO</span>
        <span style={{ ...mono, fontSize: 10, color: 'var(--text-dim)' }}>agent</span>
        {/* fast / thinking toggle (spec §03) */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', background: 'var(--elev)', border: '1px solid var(--line-4)', borderRadius: 7, padding: 2, ...mono, fontSize: 10 }}>
          <button onClick={() => thinking && toggleThinking()} style={{ padding: '3px 9px', borderRadius: 5, color: thinking ? 'var(--text-2)' : 'var(--live-ink)', background: thinking ? 'transparent' : 'var(--live)', fontWeight: thinking ? 400 : 700 }}>fast</button>
          <button onClick={() => !thinking && toggleThinking()} style={{ padding: '3px 9px', borderRadius: 5, color: thinking ? 'var(--live-ink)' : 'var(--text-2)', background: thinking ? 'var(--maestro)' : 'transparent', fontWeight: thinking ? 700 : 400 }}>thinking</button>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...mono, fontSize: 10, color: 'var(--text-1)', background: 'var(--elev)', border: '1px solid var(--line-4)', borderRadius: 6, padding: '3px 8px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: genProv?.connected && !localOnly ? 'var(--maestro)' : 'var(--text-dim)' }} />
          {modelTag}
        </span>
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
          <DirectivePalette query={query} custom={custom} highlightId={matches[Math.min(hi, Math.max(matches.length - 1, 0))]?.id} onPick={pick} />
        )}
        {atOpen && mentionOpts.length > 0 && <MentionPicker opts={mentionOpts} hi={hi} onPick={pickMention} />}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 8, padding: '8px 11px' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: '20px' }}>▷</span>
          <textarea
            ref={taRef}
            id="maestro-input"
            name="maestro-input"
            aria-label="Speak music, slash for commands, at-sign to reference"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              const list = paletteOpen ? matches : atOpen ? mentionOpts : [];
              if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setHi((h) => (e.key === 'ArrowDown' ? (h + 1) % list.length : (h - 1 + list.length) % list.length));
              } else if (atOpen && mentionOpts.length && e.key === 'Enter') {
                e.preventDefault();
                pickMention(mentionOpts[Math.min(hi, mentionOpts.length - 1)]);
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                setInput('');
              }
            }}
            rows={1}
            placeholder="Speak music · / commands · @ reference a voice, scene or sample"
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

// ---- @-mention picker ----
interface MentionOpt { token: string; label: string; group: string; color: string }
function buildMentions(voices: { id: string; sigil: string; color: string }[], scenes: { name: string }[], q: string): MentionOpt[] {
  const opts: MentionOpt[] = [
    ...voices.map((v) => ({ token: v.sigil, label: v.sigil, group: 'VOICES', color: v.color })),
    ...scenes.map((s) => ({ token: s.name, label: s.name, group: 'SCENES', color: 'var(--live)' })),
  ];
  return opts.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 8);
}

function MentionPicker({ opts, hi, onPick }: { opts: MentionOpt[]; hi: number; onPick: (m: MentionOpt) => void }) {
  return (
    <div className="refr-settle" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, maxHeight: 240, overflowY: 'auto', background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 10, boxShadow: 'var(--shadow)', zIndex: 20, padding: '6px 0' }}>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: '.16em', color: 'var(--text-dim)', padding: '6px 14px 6px' }}>REFERENCE CONTEXT</div>
      {opts.map((o, i) => (
        <button key={o.token + i} onMouseDown={(e) => { e.preventDefault(); onPick(o); }} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '7px 14px', background: i === hi % opts.length ? 'var(--active-line)' : 'transparent' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: o.color, flex: 'none' }} />
          <span style={{ ...mono, fontSize: 12, color: 'var(--text)' }}>{o.label}</span>
          <span style={{ marginLeft: 'auto', ...mono, fontSize: 9.5, color: 'var(--text-dim)' }}>{o.group}</span>
        </button>
      ))}
    </div>
  );
}

// ---- messages ----
function MessageView({ m }: { m: MaestroMessage }) {
  if (m.role === 'user') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '88%', background: 'var(--user-bubble)', borderRadius: '9px 9px 2px 9px', padding: '9px 12px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)' }}>
        {renderRich(m.text)}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {m.reasoning && <Reasoning text={m.reasoning} />}
      {m.plan && m.plan.length > 0 && <PlanView plan={m.plan} />}
      {m.toolLog && m.toolLog.length > 0 && <ToolLog log={m.toolLog} />}
      <div
        style={{
          maxWidth: m.shape === 'lanes' ? '100%' : '94%',
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

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'r') setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div style={{ border: '1px solid var(--line-3)', borderRadius: 9, overflow: 'hidden', background: 'var(--bg-deep)' }}>
      <button onClick={() => setOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', ...mono, fontSize: 10.5, color: 'var(--text-2)', borderBottom: open ? '1px solid var(--line-3)' : 'none' }}>
        <span style={{ color: 'var(--maestro)' }}>{open ? '▾' : '▸'}</span> reasoning
        <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>fold ⌥R</span>
      </button>
      {open && <div style={{ padding: '10px 13px', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>{text}</div>}
    </div>
  );
}

function PlanView({ plan }: { plan: PlanStep[] }) {
  const done = plan.filter((s) => s.status === 'done').length;
  return (
    <div style={{ border: '1px solid var(--line-4)', borderRadius: 9, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', background: 'var(--elev-2)', borderBottom: '1px solid var(--line-3)', ...mono, fontSize: 10, letterSpacing: '.14em', color: 'var(--text-1)' }}>
        PLAN<span style={{ color: 'var(--text-dim)', letterSpacing: 0 }}>· {plan.length} steps · {done} done</span>
      </div>
      <div style={{ padding: '6px 0', fontSize: 12.5 }}>
        {plan.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 14px', background: s.status === 'running' ? 'color-mix(in srgb, var(--maestro) 6%, transparent)' : 'transparent' }}>
            <StepDot status={s.status} />
            <span style={{ color: s.status === 'done' ? 'var(--text-dim)' : 'var(--text-1)', textDecoration: s.status === 'done' ? 'line-through' : 'none' }}>{renderRich(s.text)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepDot({ status }: { status: PlanStep['status'] }) {
  if (status === 'done') return <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--live)', color: 'var(--live-ink)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flex: 'none' }}>✓</span>;
  if (status === 'running') return <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--maestro)', flex: 'none' }} />;
  return <span style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid var(--line-6)', flex: 'none' }} />;
}

function ToolLog({ log }: { log: ToolCall[] }) {
  return (
    <div style={{ border: '1px solid var(--line-3)', borderRadius: 9, overflow: 'hidden', background: 'var(--bg-deep)' }}>
      <div style={{ padding: '8px 13px', borderBottom: '1px solid var(--line-3)', ...mono, fontSize: 10, letterSpacing: '.14em', color: 'var(--text-dim)' }}>TOOL LOG</div>
      <div style={{ padding: '5px 0', ...mono, fontSize: 11 }}>
        {log.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 14px', color: 'var(--text-2)' }}>
            <span style={{ color: 'var(--c-voice)' }}>{t.glyph}</span>
            <span style={{ color: 'var(--text-1)' }}>{t.name}</span>
            <span style={{ color: 'var(--text-dim)' }}>{t.detail}</span>
            <span style={{ marginLeft: 'auto', color: t.ok ? 'var(--live)' : 'var(--panic)' }}>{t.ok ? `✓${t.ms != null ? ` ${t.ms}ms` : ''}` : '✕'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffActions({ editId }: { editId: string }) {
  const staged = useStore((s) => s.stagedEdit);
  const accept = useStore((s) => s.acceptEdit);
  const reject = useStore((s) => s.rejectEdit);
  const openSurface = useStore((s) => s.openSurface);
  const isLive = staged?.id === editId;
  if (!isLive) {
    return <div style={{ ...mono, fontSize: 10.5, color: 'var(--text-dim)' }}>— resolved —</div>;
  }
  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      <button onClick={accept} style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 5, padding: '5px 11px' }}>
        Accept ⏎
      </button>
      <button onClick={reject} style={{ ...mono, fontSize: 10.5, color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '5px 11px' }}>
        Reject ⌫
      </button>
      <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '5px 9px' }}>▣ diff</span>
      <button onClick={() => openSurface('history')} style={{ ...mono, fontSize: 10.5, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '5px 9px' }}>⟐ provenance</button>
    </div>
  );
}

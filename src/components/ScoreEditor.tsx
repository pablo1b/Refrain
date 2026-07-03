import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, Compartment, Transaction, RangeSet, type Range } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  gutter,
  GutterMarker,
  Decoration,
  type DecorationSet,
  WidgetType,
  type BlockInfo,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { parseScore } from '../music/parseScore';
import { useStore } from '../state/store';
import { buildMiniRoll } from './miniRoll';
import type { MiniRollMode } from '../types';
import type { EngineEvent } from '../audio/strudelEngine';

// ---- grounded completion vocabulary (spec §02) ----
// Every name here is a REAL Strudel method/function (verified against the
// strudel-patterns skill) — completion is grounded in the live API, your named
// voices and note literals, not a guessed token stream.
const STRUDEL_METHODS = [
  'gain', 'pan', 'lpf', 'hpf', 'lpq', 'hpq', 'bpf', 'vowel', 'room', 'roomsize', 'delay', 'delaytime', 'delayfeedback',
  'distort', 'crush', 'coarse', 'speed', 'begin', 'end', 'chop', 'striate', 'slice', 'loopAt', 'bank', 'clip', 'legato',
  'attack', 'decay', 'sustain', 'release', 'adsr', 'fm', 'fmh', 'vib', 'note', 'n', 's', 'sound', 'freq',
  'scale', 'transpose', 'scaleTranspose', 'add', 'arp', 'chord', 'voicing', 'rootNotes',
  'fast', 'slow', 'hurry', 'rev', 'palindrome', 'iter', 'iterBack', 'ply', 'segment', 'struct', 'mask', 'euclid', 'euclidRot',
  'swingBy', 'swing', 'every', 'firstOf', 'lastOf', 'when', 'within', 'chunk', 'off', 'superimpose', 'layer', 'jux', 'juxBy',
  'echo', 'degradeBy', 'degrade', 'sometimesBy', 'sometimes', 'often', 'rarely', 'someCyclesBy', 'late', 'early',
  'range', 'range2', 'rangex', 'div', 'mul', 'sub',
];
const STRUDEL_FUNCS = ['s', 'n', 'note', 'sound', 'freq', 'stack', 'cat', 'seq', 'silence', 'run', 'setcps', 'setcpm'];
const STRUDEL_SIGNALS = ['sine', 'cosine', 'saw', 'isaw', 'tri', 'square', 'perlin', 'rand', 'irand', 'choose', 'chooseCycles'];

function strudelCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w$]*/);
  if (!word) return null;
  const before = context.state.sliceDoc(Math.max(0, word.from - 1), word.from);
  const isMethod = before === '.';
  if (word.from === word.to && !context.explicit && !isMethod) return null;
  if (isMethod) {
    return {
      from: word.from,
      options: STRUDEL_METHODS.map((m) => ({ label: m, type: 'method', detail: '(…)', boost: 1 })),
      validFor: /[\w]*/,
    };
  }
  const sigils = parseScore(context.state.doc.toString()).voices.map((v) => v.sigil);
  return {
    from: word.from,
    options: [
      ...sigils.map((sg) => ({ label: sg, type: 'variable', detail: 'voice' })),
      ...STRUDEL_FUNCS.map((f) => ({ label: f, type: 'function' })),
      ...STRUDEL_SIGNALS.map((s) => ({ label: s, type: 'constant', detail: 'signal' })),
    ],
    validFor: /[\w$]*/,
  };
}

// ---- syntax colours mapped to the themed CSS vars (cool code palette) ----
const refrainHighlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--c-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--c-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--c-num)' },
  { tag: [t.function(t.variableName), t.variableName, t.propertyName], color: 'var(--c-func)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--c-punct)' },
  { tag: t.keyword, color: 'var(--c-func)' },
]);

// theme variant follows the app's data-theme so CodeMirror's base styles
// (selection fallback, color-scheme) match light/dark.
const makeEditorTheme = (dark: boolean) =>
  EditorView.theme(
    {
      '&': { color: 'var(--text-1)', backgroundColor: 'transparent', height: '100%', fontSize: '13px' },
      '.cm-content': { fontFamily: 'var(--font-mono)', padding: '14px 0 60px', caretColor: 'var(--live)' },
      '.cm-scroller': { lineHeight: '1.9', overflow: 'auto' },
      '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--gutter)', border: 'none', paddingRight: '6px' },
      '.cm-lineNumbers .cm-gutterElement': { fontSize: '12px', minWidth: '30px' },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-cursor': { borderLeftColor: 'var(--live)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(106,160,255,0.20)' },
      '.cm-voiceSigil': { color: 'var(--c-voice)', fontWeight: '600' },
      '.cm-activeVoice': { backgroundColor: 'var(--active-line)', boxShadow: 'inset 2px 0 0 0 var(--live)' },
      '.cm-playMarker': { color: 'var(--live)', fontSize: '10px', fontFamily: 'var(--font-mono)', marginLeft: '14px', opacity: '0.9' },
    },
    { dark },
  );

const themeCompartment = new Compartment();

/** Set the active voice to the one under the editor caret (for ⌘K). */
function selectVoiceUnderCaret(view: EditorView) {
  const head = view.state.selection.main.head;
  const lineNo = view.state.doc.lineAt(head).number - 1; // 0-based
  const { voices } = parseScore(view.state.doc.toString());
  const v = voices.find((vv) => lineNo >= vv.startLine && lineNo <= vv.endLine);
  if (v) useStore.getState().selectVoice(v.id);
  window.dispatchEvent(new CustomEvent('refrain:focus-maestro'));
}

/** The pin context for a gutter line — its voice block, or the bare line (§02). */
function ctxForLine(view: EditorView, line0: number): { voiceId?: string; startLine: number; endLine: number } {
  const { voices } = parseScore(view.state.doc.toString());
  const v = voices.find((vv) => line0 >= vv.startLine && line0 <= vv.endLine);
  if (v) return { voiceId: v.id, startLine: v.startLine + 1, endLine: v.endLine + 1 };
  return { startLine: line0 + 1, endLine: line0 + 1 };
}

/** 0-based line under a client Y — for gutter drag-selection (spec §12.2). */
function lineAtClientY(view: EditorView, clientY: number): number {
  const rect = view.dom.getBoundingClientRect();
  const pos = view.posAtCoords({ x: rect.left + 5, y: clientY });
  if (pos == null) return clientY < rect.top ? 0 : view.state.doc.lines - 1;
  return view.state.doc.lineAt(pos).number - 1;
}

/**
 * The gutter gesture set (spec §12.2): click pins a voice block, drag pins a
 * contiguous line range, ⇧-click extends the last range, ⌘/⌃-click adds a
 * disjoint range, clicking a pinned line toggles it off. Pins ride into a
 * Maestro turn in gutter order.
 */
function onGutterMouseDown(view: EditorView, line: BlockInfo, event: MouseEvent) {
  event.preventDefault();
  const store = useStore.getState();
  const line0 = view.state.doc.lineAt(line.from).number - 1;
  const ctx = ctxForLine(view, line0);
  if (ctx.voiceId) store.selectVoice(ctx.voiceId);

  if (event.shiftKey) {
    store.extendLastPin(line0 + 1); // ⇧ extends the last range to here
    return;
  }
  if (event.metaKey || event.ctrlKey) {
    store.addPin({ voiceId: ctx.voiceId, startLine: ctx.startLine, endLine: ctx.endLine }); // ⌘/⌃ disjoint add
    return;
  }
  const covering = store.pins.find((p) => line0 + 1 >= p.startLine && line0 + 1 <= p.endLine);
  if (covering) {
    store.removePin(covering.id); // click a pinned line → toggle off
    return;
  }

  // otherwise: a click pins the voice block; a drag pins a contiguous line range
  let moved = false;
  let pinId: string | null = null;
  const onMove = (e: MouseEvent) => {
    if (!view.dom.isConnected) return onUp(); // editor unmounted mid-drag → self-clean
    const cur = lineAtClientY(view, e.clientY);
    if (cur === line0 && !moved) return;
    moved = true;
    const lo = Math.min(line0, cur);
    const hi = Math.max(line0, cur);
    if (pinId == null) pinId = store.addPin({ startLine: lo + 1, endLine: hi + 1 });
    else store.updatePin(pinId, { startLine: lo + 1, endLine: hi + 1, voiceId: undefined });
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (!moved) store.addPin({ voiceId: ctx.voiceId, startLine: ctx.startLine, endLine: ctx.endLine });
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ---- inline gutter mini-roll (spec §12.5) ----
// A tiny per-voice piano-roll beside its definition line, sharing the Tracker's
// event data + colour. Pushed in from the store via a StateEffect; the gutter
// recomputes its markers when that effect fires (lineMarkerChange).
interface MiniData {
  on: boolean;
  scoreLens: boolean;
  voices: { id: string; startLine: number; color: string; expr: string }[];
  events: Record<string, EngineEvent[]>;
  mode: Record<string, MiniRollMode>;
}
const setMini = StateEffect.define<MiniData>();
const miniField = StateField.define<MiniData>({
  create: () => ({ on: false, scoreLens: false, voices: [], events: {}, mode: {} }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMini)) return e.value;
    return value;
  },
});

class MiniMarker extends GutterMarker {
  constructor(private v: { id: string; color: string; expr: string; events: EngineEvent[]; mode: 'roll' | 'spark'; scoreLens: boolean }) {
    super();
  }
  toDOM() {
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.padding = '0 4px';
    span.style.cursor = 'pointer';
    span.title = `$${this.v.id} · click to cycle roll → spark → off`;
    span.appendChild(buildMiniRoll({ events: this.v.events, color: this.v.color, mode: this.v.mode, expr: this.v.expr, scoreLens: this.v.scoreLens }));
    span.onmousedown = (e) => e.preventDefault();
    span.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      useStore.getState().cycleMiniRoll(this.v.id);
    };
    return span;
  }
}
class SpacerMarker extends GutterMarker {
  toDOM() {
    const s = document.createElement('span');
    s.style.display = 'inline-block';
    s.style.width = '0px';
    return s;
  }
}
const miniRollGutter = gutter({
  class: 'cm-miniroll',
  markers: (view) => {
    const d = view.state.field(miniField, false);
    if (!d || !d.on) return RangeSet.empty;
    const ms: Range<GutterMarker>[] = [];
    for (const v of d.voices) {
      const mode = d.mode[v.id] ?? 'roll';
      if (mode === 'off') continue;
      const ln = v.startLine + 1;
      if (ln < 1 || ln > view.state.doc.lines) continue;
      const line = view.state.doc.line(ln);
      ms.push(new MiniMarker({ id: v.id, color: v.color, expr: v.expr, events: d.events[v.id] ?? [], mode: mode === 'spark' ? 'spark' : 'roll', scoreLens: d.scoreLens }).range(line.from));
    }
    return RangeSet.of(ms, true);
  },
  lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(setMini))),
  initialSpacer: () => new SpacerMarker(),
});

// ---- dynamic decorations: active voice block + sigils + play marker ----
const setMeta = StateEffect.define<{ activeVoiceId: string | null; playing: boolean }>();

const metaField = StateField.define<{ activeVoiceId: string | null; playing: boolean }>({
  create: () => ({ activeVoiceId: null, playing: false }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMeta)) return e.value;
    return value;
  },
});

class PlayMarker extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-playMarker';
    span.textContent = '▸ playing';
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

const decoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_deco, tr) {
    // only recompute when the doc changed or the meta (active voice / playing)
    // changed — selection/cursor-only transactions just map the existing set.
    const metaChanged = tr.effects.some((e) => e.is(setMeta));
    if (!tr.docChanged && !metaChanged) return _deco.map(tr.changes);
    const meta = tr.state.field(metaField);
    const code = tr.state.doc.toString();
    const { voices } = parseScore(code);
    const active = voices.find((v) => v.id === meta.activeVoiceId);
    const ranges: Range<Decoration>[] = [];
    const lineMark = Decoration.line({ class: 'cm-activeVoice' });
    const sigilMark = Decoration.mark({ class: 'cm-voiceSigil' });

    // active-voice block line backgrounds (line decorations sort before marks)
    if (active) {
      for (let ln = active.startLine; ln <= active.endLine; ln++) {
        if (ln + 1 <= tr.state.doc.lines) ranges.push(lineMark.range(tr.state.doc.line(ln + 1).from));
      }
    }
    // every $sigil at line start
    for (let i = 1; i <= tr.state.doc.lines; i++) {
      const line = tr.state.doc.line(i);
      const m = line.text.match(/^(\s*)(\$[A-Za-z_]\w*)/);
      if (m) {
        const from = line.from + m[1].length;
        ranges.push(sigilMark.range(from, from + m[2].length));
      }
    }
    // play marker on the active voice's first line
    if (active && meta.playing) {
      const first = tr.state.doc.line(active.startLine + 1);
      ranges.push(Decoration.widget({ widget: new PlayMarker(), side: 1 }).range(first.to));
    }
    // Decoration.set sorts by from + startSide for us
    return Decoration.set(ranges, true);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function ScoreEditor() {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const score = useStore((s) => s.score);
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const playing = useStore((s) => s.playing);
  const theme = useStore((s) => s.theme);
  const setScore = useStore((s) => s.setScore);
  const play = useStore((s) => s.play);
  // inline mini-roll inputs (spec §12.5)
  const voices = useStore((s) => s.voices);
  const events = useStore((s) => s.events);
  const miniRoll = useStore((s) => s.miniRoll);
  const lenses = useStore((s) => s.lenses);

  // build the editor once
  useEffect(() => {
    if (!ref.current) return;
    const state = EditorState.create({
      doc: useStore.getState().score,
      extensions: [
        lineNumbers({
          domEventHandlers: {
            // gutter gesture set: click / drag / ⇧ / ⌘ pin ranges (spec §02, §12.2)
            mousedown: (view, block, event) => {
              onGutterMouseDown(view, block, event as MouseEvent);
              return true;
            },
          },
        }),
        miniField,
        miniRollGutter,
        history(),
        highlightActiveLine(),
        javascript(),
        syntaxHighlighting(refrainHighlight),
        autocompletion({ override: [strudelCompletions], activateOnTyping: true, icons: false }),
        themeCompartment.of(makeEditorTheme(useStore.getState().theme === 'dark')),
        metaField,
        decoField,
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              useStore.getState().play();
              return true;
            },
          },
          {
            key: 'Mod-k',
            run: (v) => {
              selectVoiceUnderCaret(v);
              return true;
            },
          },
          ...completionKeymap,
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          // ignore the echo from our own programmatic sync (external score change),
          // which already matches the store — only user edits differ from it.
          if (u.docChanged && u.state.doc.toString() !== useStore.getState().score) {
            setScore(u.state.doc.toString(), { reaudition: true });
          }
        }),
        EditorView.lineWrapping,
      ],
    });
    const view = new EditorView({ state, parent: ref.current });
    viewRef.current = view;
    view.dispatch({ effects: setMeta.of({ activeVoiceId: useStore.getState().activeVoiceId, playing: useStore.getState().playing }) });
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external score changes (accept/commit/lane) → sync editor doc with a
  // MINIMAL change (common prefix/suffix) so the caret stays put, kept out of
  // the user's undo history.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === score) return;
    let start = 0;
    const min = Math.min(cur.length, score.length);
    while (start < min && cur[start] === score[start]) start++;
    let endCur = cur.length;
    let endNew = score.length;
    while (endCur > start && endNew > start && cur[endCur - 1] === score[endNew - 1]) {
      endCur--;
      endNew--;
    }
    view.dispatch({
      changes: { from: start, to: endCur, insert: score.slice(start, endNew) },
      annotations: Transaction.addToHistory.of(false),
      scrollIntoView: false,
    });
  }, [score]);

  // active voice / playing → update decorations
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setMeta.of({ activeVoiceId, playing }) });
  }, [activeVoiceId, playing]);

  // push the inline mini-roll data into the gutter when it changes (spec §12.5)
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setMini.of({
        on: lenses.includes('miniroll'),
        scoreLens: lenses.includes('score'),
        voices: voices.map((v) => ({ id: v.id, startLine: v.startLine, color: v.color, expr: v.expr })),
        events,
        mode: miniRoll,
      }),
    });
  }, [voices, events, miniRoll, lenses]);

  // theme → reconfigure the editor base variant (light/dark)
  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeCompartment.reconfigure(makeEditorTheme(theme === 'dark')) });
  }, [theme]);

  return (
    <div style={{ position: 'relative', height: '100%', minWidth: 0, background: 'var(--bg)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div ref={ref} style={{ flex: 1, minHeight: 0 }} onDoubleClick={() => play()} />
      <ContextBar onAsk={() => (viewRef.current ? selectVoiceUnderCaret(viewRef.current) : window.dispatchEvent(new CustomEvent('refrain:focus-maestro')))} />
    </div>
  );
}

// The Maestro context bar (spec §02): three states, never ambiguous.
// nothing pinned = whole file · gutter pins = explicit ranges (blue chips) ·
// an arc = a scoped span. Esc clears everything back to whole-file.
function ContextBar({ onAsk }: { onAsk: () => void }) {
  const pins = useStore((s) => s.pins);
  const arc = useStore((s) => s.arcSelection);
  const removePin = useStore((s) => s.removePin);
  const clearPins = useStore((s) => s.clearPins);
  const setArc = useStore((s) => s.setArcSelection);
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
  const nothing = pins.length === 0 && !arc;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: '1px solid var(--line-3)', background: 'var(--bg-deep)', flexWrap: 'wrap', minHeight: 40 }}>
      <span style={{ ...mono, fontSize: 9.5, letterSpacing: '.14em', color: 'var(--text-dim)' }}>MAESTRO CONTEXT</span>
      {nothing && <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-3)' }}>whole file · click a line № to pin</span>}
      {pins.map((p) => (
        <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, ...mono, fontSize: 10.5, color: 'var(--select)', background: 'color-mix(in srgb, var(--select) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--select) 40%, transparent)', borderRadius: 6, padding: '3px 8px' }}>
          <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--select)' }} />
          {p.voiceId ? `$${p.voiceId}` : 'line'} · L{p.startLine}{p.endLine !== p.startLine ? `–${p.endLine}` : ''}
          <button onClick={() => removePin(p.id)} style={{ color: 'var(--select)', opacity: 0.7 }}>✕</button>
        </span>
      ))}
      {arc && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, ...mono, fontSize: 10.5, color: 'var(--live)', background: 'color-mix(in srgb, var(--live) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--live) 40%, transparent)', borderRadius: 6, padding: '3px 8px' }}>
          ◷ arc span
          <button onClick={() => setArc(null)} style={{ color: 'var(--live)', opacity: 0.8 }}>✕</button>
        </span>
      )}
      {!nothing && <span style={{ ...mono, fontSize: 10, color: 'var(--text-2)' }}>{pins.length ? `${pins.length} pinned` : ''}</span>}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {!nothing && (
          <button onClick={() => { clearPins(); setArc(null); }} style={{ ...mono, fontSize: 10.5, color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 6, padding: '4px 9px' }}>
            ⊘ clear · <span style={{ color: 'var(--maestro)' }}>Esc</span>
          </button>
        )}
        <button onClick={onAsk} style={{ ...mono, fontSize: 10.5, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 6, padding: '4px 9px' }}>
          <span style={{ color: 'var(--maestro)' }}>⌘K</span> ask inline
        </button>
      </span>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, Compartment, Transaction, type Range } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  Decoration,
  type DecorationSet,
  WidgetType,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { parseScore } from '../music/parseScore';
import { useStore } from '../state/store';

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

  // build the editor once
  useEffect(() => {
    if (!ref.current) return;
    const state = EditorState.create({
      doc: useStore.getState().score,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        javascript(),
        syntaxHighlighting(refrainHighlight),
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
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setScore(u.state.doc.toString(), { reaudition: true });
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

  // theme → reconfigure the editor base variant (light/dark)
  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeCompartment.reconfigure(makeEditorTheme(theme === 'dark')) });
  }, [theme]);

  return (
    <div style={{ position: 'relative', height: '100%', minWidth: 0, background: 'var(--bg)', overflow: 'hidden' }}>
      <div ref={ref} style={{ height: '100%' }} onDoubleClick={() => play()} />
      <button
        onClick={() => (viewRef.current ? selectVoiceUnderCaret(viewRef.current) : window.dispatchEvent(new CustomEvent('refrain:focus-maestro')))}
        style={{
          position: 'absolute',
          left: 44,
          bottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--elev)',
          border: '1px solid var(--line-5)',
          borderRadius: 7,
          padding: '6px 11px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-2)',
        }}
      >
        <span style={{ color: 'var(--maestro)' }}>⌘K</span> ask the Maestro inline
      </button>
    </div>
  );
}

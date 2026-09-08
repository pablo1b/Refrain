import { describe, it, expect, beforeEach, vi } from 'vitest';

// v0.2.1 store behaviours (spec §12): effort×routing, pin gestures, voice-granular
// merge, mini-roll, transport key, motion. Same boundary mocks as store.test.ts.
vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});
vi.mock('../llm/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm/providers')>();
  return { ...actual, chat: vi.fn() };
});

import { useStore, DEFAULT_SCORE, commitById } from './store';
import { engine } from '../audio/strudelEngine';
import { resetStore, state } from '../../tests/helpers/store';

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

// ---- §12.4 effort × routing ----
describe('effort toggle × routing (spec §12.4)', () => {
  it('defaults to auto and never re-vendors — with no reasoning tier it stays fast', () => {
    expect(state().effort).toBe('auto');
    // no provider connected → no reasoning tier → thinking always false
    expect(state().resolveTurnEffort('generation', true)).toEqual({ thinking: false, trace: false });
  });

  it('auto lets the role decide: tasks think, directives do not', () => {
    state().setProviderKey('anthropic', 'sk-test'); // generation role → anthropic sonnet (reasons)
    state().setEffort('auto');
    expect(state().resolveTurnEffort('generation', true).thinking).toBe(true); // a task
    expect(state().resolveTurnEffort('generation', false).thinking).toBe(false); // a directive
  });

  it('fast forces no trace; thinking forces the reasoning tier', () => {
    state().setProviderKey('anthropic', 'sk-test');
    state().setEffort('fast');
    expect(state().resolveTurnEffort('generation', true)).toEqual({ thinking: false, trace: false });
    state().setEffort('thinking');
    expect(state().resolveTurnEffort('generation', true)).toEqual({ thinking: true, trace: true });
  });

  it('greys to fast when the role model has no reasoning tier', () => {
    state().setProviderKey('google', 'k');
    state().setRoleProvider('generation', 'google', 'gemini-flash-latest');
    state().setEffort('thinking');
    expect(state().resolveTurnEffort('generation', true)).toEqual({ thinking: false, trace: false });
  });

  it('shows the /break reasoning trace in auto, hides it in fast', async () => {
    await state().runBreak();
    const withTrace = state().messages.filter((m) => m.role === 'maestro').at(-1);
    expect(withTrace?.reasoning).toBeTruthy();
    expect(withTrace?.plan?.length).toBeGreaterThan(0); // plan/tool log stay visible either way

    resetStore();
    state().setEffort('fast');
    await state().runBreak();
    const noTrace = state().messages.filter((m) => m.role === 'maestro').at(-1);
    expect(noTrace?.reasoning).toBeUndefined();
    expect(noTrace?.plan?.length).toBeGreaterThan(0);
  });
});

// ---- §12.2 gutter pin gestures ----
describe('pin gestures (spec §12.2)', () => {
  it('addPin returns the id (new) and the existing id on a dupe', () => {
    const a = state().addPin({ voiceId: 'hats', startLine: 5, endLine: 6 });
    const b = state().addPin({ voiceId: 'hats', startLine: 5, endLine: 6 });
    expect(a).toBe(b);
    expect(state().pins).toHaveLength(1);
  });

  it('updatePin patches a range (drag) and extendLastPin grows the last range', () => {
    const id = state().addPin({ startLine: 4, endLine: 4 });
    state().updatePin(id, { startLine: 4, endLine: 6 });
    expect(state().pins[0]).toMatchObject({ startLine: 4, endLine: 6 });
    state().extendLastPin(9); // ⇧-click extends
    expect(state().pins[0]).toMatchObject({ startLine: 4, endLine: 9 });
  });

  it('remaps a voice pin to the voice’s new span when the score shifts (AST anchor)', () => {
    const hats = state().voices.find((v) => v.id === 'hats')!;
    state().addPin({ voiceId: 'hats', startLine: hats.startLine + 1, endLine: hats.endLine + 1 });
    // insert two blank lines at the very top → every voice moves down by 2
    state().setScore('\n\n' + DEFAULT_SCORE);
    const movedHats = state().voices.find((v) => v.id === 'hats')!;
    expect(state().pins[0].startLine).toBe(movedHats.startLine + 1);
  });

  it('drops a voice pin when its voice is deleted', () => {
    state().addPin({ voiceId: 'pad', startLine: 11, endLine: 13 });
    state().setScore('$drums: s("bd")'); // pad no longer exists
    expect(state().pins).toHaveLength(0);
  });
});

// ---- §12.5 mini-roll ----
describe('mini-roll per-voice mode (spec §12.5)', () => {
  it('cycles roll → spark → off → roll', () => {
    expect(state().miniRoll.hats).toBeUndefined(); // defaults to roll
    state().cycleMiniRoll('hats');
    expect(state().miniRoll.hats).toBe('spark');
    state().cycleMiniRoll('hats');
    expect(state().miniRoll.hats).toBe('off');
    state().cycleMiniRoll('hats');
    expect(state().miniRoll.hats).toBe('roll');
  });
});

// ---- §12.3 / §12.8 device prefs ----
describe('device prefs (spec §12.3, §12.8)', () => {
  it('sets the transport key', () => {
    expect(state().transportKey).toBe('mod-shift-enter');
    state().setTransportKey('f5');
    expect(state().transportKey).toBe('f5');
  });

  it('sets the motion preference and reflects it onto <html>', () => {
    state().setMotion('reduced');
    expect(state().motion).toBe('reduced');
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('on');
    state().setMotion('full');
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('off');
  });
});

// ---- §12.6 voice-granular merge ----
describe('voice-granular merge (spec §12.6)', () => {
  const drumsEdit = DEFAULT_SCORE.replace('"bd*2, ~ sd"', '"bd*4"');
  const bassEdit = DEFAULT_SCORE.replace('"c2 eb2 g2 c3"', '"c2 c2 c2 c2"');
  const drumsEditB = DEFAULT_SCORE.replace('"bd*2, ~ sd"', '"bd*8"');

  function commit(scoreStr: string, label: string) {
    state().setScore(scoreStr);
    state().saveCheckpoint(label);
    return state().headId!;
  }

  it('auto-unions disjoint voice edits with no conflict', () => {
    const rootId = state().headId!;
    const aId = commit(drumsEdit, 'A'); // edits $drums
    state().rewind(rootId);
    commit(bassEdit, 'B'); // edits $bass (HEAD)
    state().mergeInto(aId);
    expect(state().pendingMerge).toBeNull();
    expect(state().score).toContain('"bd*4"'); // theirs (A)
    expect(state().score).toContain('"c2 c2 c2 c2"'); // ours (B)
  });

  it('raises a same-voice conflict and resolves it "keep theirs"', () => {
    const rootId = state().headId!;
    const aId = commit(drumsEdit, 'A'); // $drums → bd*4
    state().rewind(rootId);
    commit(drumsEditB, 'B'); // $drums → bd*8 (HEAD)
    state().mergeInto(aId);
    expect(state().pendingMerge).not.toBeNull();
    expect(state().pendingMerge!.conflicts.map((c) => c.voiceId)).toEqual(['drums']);
    state().resolveMerge({ drums: 'theirs' });
    expect(state().pendingMerge).toBeNull();
    expect(state().score).toContain('"bd*4"'); // theirs won
    expect(state().score).not.toContain('"bd*8"');
  });

  it('records a merge commit with the branch as a second parent', () => {
    const rootId = state().headId!;
    const aId = commit(drumsEdit, 'A');
    state().rewind(rootId);
    commit(bassEdit, 'B');
    state().mergeInto(aId);
    const head = state().history.find((c) => c.id === state().headId);
    expect(head?.provenance.source).toBe('merge');
    expect(head?.mergeParentId).toBe(aId);
  });

  // A-3: the field has always been tracked but nothing surfaced it. The History
  // card now resolves it, so it has to be reachable AND survive a reload.
  it('resolves the second parent into a real commit via commitById', () => {
    const rootId = state().headId!;
    const aId = commit(drumsEdit, 'A');
    state().rewind(rootId);
    commit(bassEdit, 'B');
    state().mergeInto(aId);
    const head = state().history.find((c) => c.id === state().headId)!;
    const second = commitById(state().history, head.mergeParentId);
    expect(second).not.toBeNull();
    expect(second!.id).toBe(aId);
    expect(second!.label).toBe('A');
  });

  it('survives the persist round-trip', () => {
    vi.useFakeTimers();
    try {
      const rootId = state().headId!;
      const aId = commit(drumsEdit, 'A');
      state().rewind(rootId);
      commit(bassEdit, 'B');
      state().mergeInto(aId);
      const headId = state().headId!;
      vi.advanceTimersByTime(500); // let the debounced autosave flush
      const projectId = state().projectId;
      const blob = JSON.parse(localStorage.getItem(`refrain.project.${projectId}`)!);
      const persisted = blob.history.find((c: { id: string }) => c.id === headId);
      expect(persisted.mergeParentId).toBe(aId);

      // …and back through applyBlob, which is the leg that actually matters:
      // the History card reads the REHYDRATED commit, not the raw JSON, so a
      // field that survived the write but got dropped on load would still
      // leave the second parent invisible after a reload.
      state().openProject(projectId);
      const rehydrated = commitById(state().history, headId);
      expect(rehydrated).not.toBeNull();
      expect(rehydrated!.mergeParentId).toBe(aId);
      expect(commitById(state().history, rehydrated!.mergeParentId)!.label).toBe('A');
    } finally {
      vi.useRealTimers();
    }
  });

  it('commitById is honest about a parent that is no longer in history', () => {
    expect(commitById(state().history, 'cgone')).toBeNull();
    expect(commitById(state().history, null)).toBeNull();
    expect(commitById(state().history, undefined)).toBeNull();
  });
});

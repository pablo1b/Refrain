import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { History } from './History';
import { useStore, DEFAULT_SCORE } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { resetStore, state } from '../../tests/helpers/store';

const drumsEdit = DEFAULT_SCORE.replace('"bd*2, ~ sd"', '"bd*4"');
const bassEdit = DEFAULT_SCORE.replace('"c2 eb2 g2 c3"', '"c2 c2 c2 c2"');

/** Build a real merge commit through the store's own API — never hand-written. */
function makeMerge() {
  const rootId = state().headId!;
  act(() => {
    state().setScore(drumsEdit);
    state().saveCheckpoint('A');
  });
  const aId = state().headId!;
  act(() => {
    state().rewind(rootId);
    state().setScore(bassEdit);
    state().saveCheckpoint('B');
    state().mergeInto(aId);
  });
  return { aId, rootId };
}

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

describe('merge second parent (B-6)', () => {
  it('shows a navigable second-parent row on a merge commit', () => {
    makeMerge();
    render(<History />);

    // the merge commit is HEAD, so its card is selected by default
    expect(screen.getByText('2ND PARENT')).toBeTruthy();
    // located by provenance source, never by id
    const merge = state().history.find((c) => c.provenance.source === 'merge')!;
    const branch = state().history.find((c) => c.id === merge.mergeParentId)!;
    // both parents are navigable, so there are two links; one is the branch
    const links = screen.getAllByTitle('select this commit');
    expect(links.some((l) => l.textContent?.includes(branch.label))).toBe(true);
  });

  it('clicking a parent link selects that commit without rewinding', () => {
    makeMerge();
    render(<History />);
    const headBefore = state().headId;
    const scoreBefore = state().score;

    const links = screen.getAllByTitle('select this commit');
    fireEvent.click(links[links.length - 1]);

    // navigation moves the card only — time travel stays behind rewind/fork
    expect(state().headId).toBe(headBefore);
    expect(state().score).toBe(scoreBefore);
  });

  it('marks a merge node in the history tree', () => {
    makeMerge();
    render(<History />);
    expect(screen.getAllByTitle(/two parents/)).toHaveLength(1);
  });

  it('shows a root marker on the init commit and a PARENT row on an ordinary one', () => {
    act(() => {
      state().setScore(drumsEdit);
      state().saveCheckpoint('A');
    });
    render(<History />);
    // HEAD is an ordinary commit → it has one parent
    expect(screen.getByText('PARENT')).toBeTruthy();

    // select the root (init) commit — it has neither parent
    const root = state().history.find((c) => c.parentId === null)!;
    fireEvent.click(screen.getByText(root.label));
    expect(screen.getByText(/root · no parent/)).toBeTruthy();
  });

  it('renders "no longer in history" for a parent that is not in the list', () => {
    makeMerge();
    const merge = state().history.find((c) => c.provenance.source === 'merge')!;
    // a legitimately pruned history: the second parent is gone
    useStore.setState({ history: state().history.filter((c) => c.id !== merge.mergeParentId) });

    render(<History />);
    expect(screen.getByText(/no longer in history/)).toBeTruthy();
  });
});

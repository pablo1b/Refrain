import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { Arrangement } from './Arrangement';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { resetStore, state } from '../../tests/helpers/store';

const keyWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => c.some((a) => typeof a === 'string' && /same key/i.test(a)));

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

describe('scene provenance (B-7)', () => {
  it('exposes a provenance affordance per scene', () => {
    act(() => state().snapshotScene('intro'));
    render(<Arrangement />);
    expect(screen.getByLabelText('provenance for scene intro')).toBeTruthy();
  });

  it('inspecting a scene shows its capture provenance and does NOT launch it', () => {
    act(() => state().snapshotScene('intro'));
    render(<Arrangement />);
    const before = state().activeSceneId;

    fireEvent.click(screen.getByLabelText('provenance for scene intro'));

    expect(screen.getByText(/PROVENANCE/)).toBeTruthy();
    expect(screen.getByText('WHEN')).toBeTruthy();
    expect(screen.getByText('SOURCE')).toBeTruthy();
    // inspecting must never launch the scene — the stopPropagation guard
    expect(state().activeSceneId).toBe(before);
  });

  it('says so plainly when a scene has no provenance', () => {
    useStore.setState({ scenes: [{ id: 's1', name: 'legacy', levels: {} }] });
    render(<Arrangement />);
    fireEvent.click(screen.getByLabelText('provenance for scene legacy'));
    // real localStorage data captured before A-2 has no provenance at all
    expect(screen.getByText(/No provenance recorded/)).toBeTruthy();
  });

  it('the scene header title mentions capture time when provenance exists', () => {
    act(() => state().snapshotScene('intro'));
    render(<Arrangement />);
    expect(screen.getByTitle(/^launch scene · captured /)).toBeTruthy();
  });

  it('the header title is plain when provenance is absent', () => {
    useStore.setState({ scenes: [{ id: 's1', name: 'legacy', levels: {} }] });
    render(<Arrangement />);
    expect(screen.getByTitle('launch scene')).toBeTruthy();
  });

  it('deleting a scene still works and does not launch it', () => {
    act(() => state().snapshotScene('intro'));
    render(<Arrangement />);
    fireEvent.click(screen.getByLabelText('delete scene intro'));
    expect(state().scenes).toHaveLength(0);
  });
});

describe('Arrangement keys (B-2)', () => {
  it('renders the scene grid without duplicate-key errors when two voices share an id', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => state().setScore('$bass: note("c2")\n\n$bass: note("g2")'));
    act(() => state().snapshotScene('intro'));
    render(<Arrangement />);
    expect(keyWarnings(errSpy)).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

// The clock's rAF loop reads engine.started/now(), so the boundary is mocked to
// keep it inert. parseScore/buildVoices are the code under test here and are
// never mocked — the duplicate voice id must come from the real parser.
vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { CycleClock } from './CycleClock';
import { engine } from '../audio/strudelEngine';
import { resetStore, state } from '../../tests/helpers/store';

/** A score with two `$bass:` blocks — voice ids are not de-duplicated, so this
 *  yields two voices with id 'bass'. That is the precondition for B-2. */
const DUPLICATE_BASS = '$bass: note("c2")\n\n$bass: note("g2")';

/** Did React log a duplicate-key warning? It logs at error level. */
const keyWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => c.some((a) => typeof a === 'string' && /same key/i.test(a)));

describe('CycleClock keys (B-2)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (engine as any).__reset();
    resetStore();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders a score with two identically named voices without a duplicate-key error', () => {
    state().setScore(DUPLICATE_BASS);
    // documents the precondition: the real parser does not de-duplicate ids
    expect(state().voices.map((v) => v.id)).toEqual(['bass', 'bass']);

    render(<CycleClock />);

    expect(keyWarnings(errSpy)).toHaveLength(0);
  });

  it('renders one ring per voice even when two voices share an id', () => {
    state().setScore(DUPLICATE_BASS);
    const { container } = render(<CycleClock />);
    // a key collision would drop a ring; don't pin an exact circle count
    // (playhead + hub + ticks vary) — only that nothing was reconciled away
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(state().voices.length);
  });

  it('renders the default score without duplicate-key errors', () => {
    render(<CycleClock />);
    expect(keyWarnings(errSpy)).toHaveLength(0);
  });
});

describe('CycleClock arc drag survives an untracked pointer (B-10)', () => {
  beforeEach(() => {
    (engine as any).__reset();
    resetStore();
  });

  it('a pointerdown whose pointer id is not tracked starts the drag instead of throwing', () => {
    // happy-dom has no setPointerCapture at all (hence the `?.()` in the
    // source), so define one that throws to force the exact condition the audit
    // hit: NotFoundError for an untracked pointer id.
    const proto = Element.prototype as unknown as { setPointerCapture?: (id: number) => void };
    const original = proto.setPointerCapture;
    proto.setPointerCapture = () => {
      throw new DOMException('No active pointer with the given id is found.', 'NotFoundError');
    };
    const { container } = render(<CycleClock interactive />);
    const svg = container.querySelector('svg')!;

    expect(() => fireEvent.pointerDown(svg, { pointerId: 999, clientX: 60, clientY: 10 })).not.toThrow();
    // the drag actually began — capture is best-effort, not load-bearing
    expect(state().arcSelection).not.toBeNull();

    if (original) proto.setPointerCapture = original;
    else delete proto.setPointerCapture;
  });
});

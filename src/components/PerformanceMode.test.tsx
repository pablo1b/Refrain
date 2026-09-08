import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { PerformanceMode } from './PerformanceMode';
import { engine } from '../audio/strudelEngine';
import { resetStore, state } from '../../tests/helpers/store';

const DUPLICATE_BASS = '$bass: note("c2")\n\n$bass: note("g2")';
const keyWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => c.some((a) => typeof a === 'string' && /same key/i.test(a)));

describe('PerformanceMode keys (B-2)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    (engine as any).__reset();
    resetStore();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders both voice lists with two identically named voices without a duplicate-key error', () => {
    state().setScore(DUPLICATE_BASS);
    render(<PerformanceMode />);
    expect(keyWarnings(errSpy)).toHaveLength(0);
  });
});

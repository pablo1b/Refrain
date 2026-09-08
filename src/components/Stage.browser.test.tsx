import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// The engine is a system boundary, so it is mocked — but here the mock is the
// point: `voiceLevel` IS the per-voice audio tap, so driving it directly lets us
// assert the honesty property without needing real Web Audio.
vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { Stage } from './Stage';
import { engine } from '../audio/strudelEngine';
import { useStore } from '../state/store';
import { resetStore, state } from '../../tests/helpers/store';

// ---------------------------------------------------------------------------
// Browser tier (real Chromium). The meters run off requestAnimationFrame and
// read computed layout, so happy-dom cannot exercise them honestly.
//
// This is the A8 regression: meters used to be driven by scheduled ONSETS, so a
// voice with events but no audio ran a full attack/release envelope while
// silent. Measured on the live app: `$pad` (a chord symbol in `note()`, which
// Strudel renders as nothing) read audio peak 0 for 7s with its meter at 21.
// Per-voice levels now come from each voice's own `.analyze` tap, so a voice
// that makes no sound must stay dark.
//
// CRITICAL for these tests: the silent voice must ALSO carry scheduled events,
// and the clock must advance across them. Otherwise the fallback path can only
// ever produce 0 for it, and `toBe(0)` is satisfied identically by the honest
// and the dishonest implementation — the assertion would pin nothing. Each test
// below is mutation-checked against the specific guard it claims to cover.
// ---------------------------------------------------------------------------

/** Dense onsets across the whole cycle, so any clock advance crosses one. */
const onsetsEverywhere = Array.from({ length: 8 }, (_, i) => ({
  begin: i / 8,
  dur: 1 / 8,
  gain: 1,
}));

const meterFor = (container: HTMLElement, sigil: string) =>
  [...container.querySelectorAll('[role="meter"]')].find((el) =>
    (el.getAttribute('aria-label') ?? '').startsWith(`${sigil} `),
  );

const valueOf = (container: HTMLElement, sigil: string) =>
  Number(meterFor(container, sigil)?.getAttribute('aria-valuenow') ?? -1);

const labelOf = (container: HTMLElement, sigil: string) =>
  meterFor(container, sigil)?.getAttribute('aria-label') ?? '';

/** A clock that really turns, so onsets get crossed frame to frame. */
function runningClock() {
  const t0 = performance.now();
  (engine as any).now.mockImplementation(() => (performance.now() - t0) / 1000);
}

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

describe('Stage meters (real browser)', () => {
  it('does NOT light the meter of a voice that produces no audio, even while its events fire', async () => {
    (engine as any).ready = true;
    (engine as any).started = true;
    runningClock();
    // every voice sounds except $pad, whose tap reads a GENUINE zero
    (engine.voiceLevel as any).mockImplementation((id: string) =>
      id === 'pad' ? { rms: 0, peak: 0 } : { rms: 0.4, peak: 0.9 },
    );
    // ...and $pad is the voice with the most scheduled events, so the old
    // onset-driven path would light it hardest of all.
    useStore.setState({ playing: true, events: { pad: onsetsEverywhere } as any });

    const { container } = render(<Stage />);
    await waitFor(() => expect(valueOf(container, '$drums')).toBeGreaterThan(20), { timeout: 2000 });

    // hold for several frames of crossed onsets — the fallback would ramp up here
    await new Promise((r) => setTimeout(r, 250));
    expect(valueOf(container, '$pad')).toBe(0); // silent voice stays dark
    expect(valueOf(container, '$drums')).toBeGreaterThan(20);
  });

  it('lights every voice whose tap reports real audio', async () => {
    (engine as any).ready = true;
    (engine as any).started = true;
    runningClock();
    (engine.voiceLevel as any).mockReturnValue({ rms: 0.4, peak: 0.8 });
    useStore.setState({ playing: true });

    const { container } = render(<Stage />);
    await waitFor(() => expect(valueOf(container, '$pad')).toBeGreaterThan(20), { timeout: 2000 });
    for (const sigil of ['$drums', '$hats', '$bass', '$pad']) {
      expect(valueOf(container, sigil)).toBeGreaterThan(20);
    }
  });

  it('calls a measured level "level"', async () => {
    (engine as any).ready = true;
    (engine as any).started = true;
    runningClock();
    (engine.voiceLevel as any).mockReturnValue({ rms: 0.4, peak: 0.8 });
    useStore.setState({ playing: true });

    const { container } = render(<Stage />);
    await waitFor(() => expect(valueOf(container, '$drums')).toBeGreaterThan(20), { timeout: 2000 });
    expect(labelOf(container, '$drums')).toBe('$drums level');
  });

  // The fallback is honest about TIMING but cannot know whether a voice reaches
  // the speakers, so the widget must not call it a "level". A meter labelled
  // "level" that is really showing scheduled onsets is the A8 dishonesty.
  it('calls the event-driven fallback "activity", not "level"', async () => {
    (engine as any).ready = true;
    (engine as any).started = true;
    runningClock();
    (engine.voiceLevel as any).mockReturnValue(null); // no tap to read
    useStore.setState({ playing: true, events: { drums: onsetsEverywhere } as any });

    const { container } = render(<Stage />);
    await waitFor(() => expect(valueOf(container, '$drums')).toBeGreaterThan(0), { timeout: 2000 });
    expect(labelOf(container, '$drums')).toBe('$drums activity');
  });

  it('falls back to onset envelopes when there is no tap to read', async () => {
    (engine as any).ready = true;
    (engine as any).started = true;
    (engine.voiceLevel as any).mockReturnValue(null); // no tap available
    // an onset at the very top of the cycle, which the clock is sitting on
    (engine as any).now.mockReturnValue(0.5);
    useStore.setState({
      playing: true,
      events: { drums: [{ begin: 0.25, dur: 0.25, gain: 1 }] } as any,
    });

    const { container } = render(<Stage />);
    // the fallback still meters $drums from its scheduled onset
    await waitFor(() => expect(valueOf(container, '$drums')).toBeGreaterThan(0), { timeout: 2000 });
  });
});

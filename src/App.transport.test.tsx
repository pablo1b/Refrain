import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

// The keymap is the code under test, so every case drives a REAL window keydown
// rather than calling the store action. The engine is mocked (play() reaches it);
// its fake scheduler clock is what makes a transport rewind observable at all.
vi.mock('./audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../tests/mocks/engine');
  return { engine: createFakeEngine() };
});
vi.mock('./llm/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./llm/providers')>();
  return { ...actual, chat: vi.fn() };
});

import App from './App';
import { useStore } from './state/store';
import { engine } from './audio/strudelEngine';
import { resetStore, state } from '../tests/helpers/store';

const fake = () => engine as unknown as { __advance: (n: number) => void; __cycle: number };

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
  useStore.setState({ mode: 'performance' });
});

/** A real ⌘⇧⏎ on the window — the default transport binding. */
const pressModShiftEnter = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  });

const pressKey = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });

describe('transport ownership in Performance Mode (B-5)', () => {
  it('a transport keypress never leaves the transport running on a rewound clock', async () => {
    render(<App />);
    await act(async () => {
      await state().play();
    });
    fake().__advance(2706);
    expect(engine.now()).toBe(2706);

    await pressModShiftEnter();

    // The regression: two owners ran togglePlay() twice — pass 1 stopped and
    // REWOUND the scheduler, pass 2 restarted it, leaving the transport "playing"
    // with the cycle counter back near 0 (the audit saw 13/14/15 instead of 2706).
    // Asserted as an unconditional invariant so it can never silently no-op.
    expect({ playing: state().playing, rewound: engine.now() < 2706 }).not.toEqual({ playing: true, rewound: true });
  });

  it('a transport keypress toggles the transport exactly once (one owner, not two)', async () => {
    render(<App />);
    await act(async () => {
      await state().play();
    });
    (engine.stop as any).mockClear();
    (engine.evaluate as any).mockClear();

    await pressModShiftEnter();

    expect(state().playing).toBe(false);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    // nothing restarted it behind the pause
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('the F5 alias is honoured by the single owner', async () => {
    useStore.setState({ transportKey: 'f5' });
    render(<App />);

    await pressKey({ key: 'F5' });
    expect(state().playing).toBe(true);

    fake().__advance(40);
    (engine.stop as any).mockClear();
    (engine.evaluate as any).mockClear();
    await pressKey({ key: 'F5' });
    expect(state().playing).toBe(false);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('only the configured key drives the transport', async () => {
    render(<App />);
    // default binding is ⌘⇧⏎, so a bare F5 must do nothing
    await pressKey({ key: 'F5' });
    expect(state().playing).toBe(false);

    useStore.setState({ transportKey: 'f5' });
    await pressModShiftEnter();
    expect(state().playing).toBe(false);
  });

  it('Esc still exits Performance Mode', async () => {
    render(<App />);
    await pressKey({ key: 'Escape' });
    expect(state().mode).toBe('studio');
  });

  it('Esc in Performance Mode does not also clear pins', async () => {
    render(<App />);
    act(() => state().addPin({ startLine: 1, endLine: 1 }));
    expect(state().pins).toHaveLength(1);

    await pressKey({ key: 'Escape' });

    // pins are a studio concept — leaving the live view must not clear them
    expect(state().mode).toBe('studio');
    expect(state().pins).toHaveLength(1);
  });

  it('PANIC still works in Performance Mode and keeps the clock turning', async () => {
    render(<App />);
    await act(async () => {
      await state().play();
    });
    fake().__advance(120);

    await pressKey({ key: '.', metaKey: true });

    expect(engine.panic).toHaveBeenCalled();
    expect(state().playing).toBe(false);
    // PANIC silences voices; it must never rewind the transport (A1 fail signal)
    expect(engine.now()).toBe(120);
  });
});

describe('App keeps every shortcut it owns (B-5)', () => {
  it('⌘O opens the project switcher', async () => {
    render(<App />);
    await pressKey({ key: 'o', metaKey: true });
    expect(state().surface).toBe('projects');
  });

  it('⌘S tags a checkpoint', async () => {
    render(<App />);
    const before = state().history.length;
    await pressKey({ key: 's', metaKey: true });
    expect(state().history.length).toBe(before + 1);
  });

  it('⌥. toggles the Prompter', async () => {
    render(<App />);
    const before = state().prompterMuted;
    await pressKey({ key: '.', altKey: true });
    expect(state().prompterMuted).toBe(!before);
  });

  it.each([
    ['k', 'refrain:focus-maestro'],
    ['p', 'refrain:command-palette'],
  ])('⌘%s dispatches %s', async (key, evt) => {
    render(<App />);
    const spy = vi.fn();
    window.addEventListener(evt, spy);
    await pressKey({ key, metaKey: true });
    window.removeEventListener(evt, spy);
    expect(spy).toHaveBeenCalled();
  });
});

// RT-1: the ordering the tests above never exercise. Every case above renders with
// `mode` ALREADY 'performance', so PerformanceMode's window listener is registered
// during the same initial commit — children's effects run first, so it registers
// BEFORE App's and preventDefault() lands before App reads the event. The real user
// path is the opposite: the app boots in studio (App's listener registered), then
// `◰ live` mounts PerformanceMode, whose listener is appended AFTER App's.
describe('Esc after entering live mode at runtime (RT-1)', () => {
  it('exits live without clearing studio context, whichever listener registered first', async () => {
    useStore.setState({ mode: 'studio' });
    render(<App />);
    act(() => state().addPin({ startLine: 1, endLine: 1 }));
    act(() => state().setArcSelection({ start: 0.1, end: 0.4 }));
    expect(state().pins).toHaveLength(1);

    // enter live the way a user does — at runtime, after App already mounted
    act(() => useStore.setState({ mode: 'performance' }));

    await pressKey({ key: 'Escape' });

    expect(state().mode).toBe('studio');
    expect(state().pins).toHaveLength(1);
    expect(state().arcSelection).not.toBeNull();
  });
});

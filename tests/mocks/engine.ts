import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fake Strudel audio engine — the SYSTEM BOUNDARY stand-in for
// src/audio/strudelEngine.ts. The real engine dynamically imports @strudel/web,
// spins up an AudioWorklet and talks to Web Audio; none of that can (or should)
// run in a unit test. This fake honours the exact contract the store relies on
// and records every call as a spy so behaviour can be asserted.
//
// Usage in a test file (the async factory dodges vi.mock hoisting/TDZ):
//
//   vi.mock('../audio/strudelEngine', async () => {
//     const { createFakeEngine } = await import('../../tests/mocks/engine');
//     return { engine: createFakeEngine() };
//   });
//   import { engine } from '../audio/strudelEngine'; // <- the fake
//
// Then in beforeEach: (engine as any).__reset();
// ---------------------------------------------------------------------------

export interface FakeEngine {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  ready: boolean;
  started: boolean;
  cps: number;
  onStatus: ((s: string, err?: string | null) => void) | null;
  init: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  panic: ReturnType<typeof vi.fn>;
  setCps: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
  queryTicks: ReturnType<typeof vi.fn>;
  queryEvents: ReturnType<typeof vi.fn>;
  getAnalyser: ReturnType<typeof vi.fn>;
  sampleOutput: ReturnType<typeof vi.fn>;
  /**
   * Models repl.scheduler.now(): cycles since the transport last started. The
   * real engine's stop() rewinds the scheduler to 0, so a double-fired
   * togglePlay() leaves the transport running on a rewound clock — the on-screen
   * cycle counter jumps back. Without a clock here that symptom is invisible to
   * tiers 1-2 and only a call-count test is possible (B-5).
   */
  __cycle: number;
  /** Advance the fake scheduler clock by n cycles. */
  __advance: (n: number) => void;
  /** Restore pristine state + default spy behaviour. Call in beforeEach. */
  __reset: () => void;
}

export function createFakeEngine(): FakeEngine {
  const e = {
    status: 'idle',
    error: null,
    ready: false,
    started: false,
    cps: 0.5,
    onStatus: null,
    init: vi.fn(),
    evaluate: vi.fn(),
    stop: vi.fn(),
    panic: vi.fn(),
    setCps: vi.fn(),
    now: vi.fn(),
    queryTicks: vi.fn(),
    queryEvents: vi.fn(),
    getAnalyser: vi.fn(),
    sampleOutput: vi.fn(),
    __cycle: 0,
    __advance: () => {},
    __reset: () => {},
  } as FakeEngine;

  function applyDefaults() {
    // init(): flips the engine to ready and fires the status callback, like the
    // real one resolving its (idempotent) init promise.
    e.init.mockImplementation(async () => {
      e.status = 'ready';
      e.ready = true;
      e.onStatus?.('ready', null);
      return true;
    });
    // evaluate(code, autoplay) starts the scheduler, like the real repl
    e.evaluate.mockImplementation(async () => {
      e.started = true;
      return { ok: true };
    });
    // repl.stop() REWINDS the scheduler to 0 — the cycle counter resets with it
    e.stop.mockImplementation(() => {
      e.started = false;
      e.__cycle = 0;
    });
    e.panic.mockResolvedValue(undefined);
    e.setCps.mockImplementation((c: number) => {
      e.cps = c;
    });
    e.now.mockImplementation(() => e.__cycle);
    e.queryTicks.mockResolvedValue([]);
    e.queryEvents.mockResolvedValue([]);
    e.getAnalyser.mockReturnValue(null);
    e.sampleOutput.mockReturnValue(null);
    e.__advance = (n: number) => {
      e.__cycle += n;
    };
  }
  applyDefaults();

  e.__reset = () => {
    e.status = 'idle';
    e.error = null;
    e.ready = false;
    e.started = false;
    e.cps = 0.5;
    e.onStatus = null;
    e.__cycle = 0;
    e.init.mockReset();
    e.evaluate.mockReset();
    e.stop.mockReset();
    e.panic.mockReset();
    e.setCps.mockReset();
    e.now.mockReset();
    e.queryTicks.mockReset();
    e.queryEvents.mockReset();
    e.getAnalyser.mockReset();
    e.sampleOutput.mockReset();
    applyDefaults();
  };

  return e;
}

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
    e.evaluate.mockResolvedValue({ ok: true });
    e.stop.mockImplementation(() => {
      e.started = false;
    });
    e.panic.mockResolvedValue(undefined);
    e.setCps.mockImplementation((c: number) => {
      e.cps = c;
    });
    e.now.mockReturnValue(0);
    e.queryTicks.mockResolvedValue([]);
  }
  applyDefaults();

  e.__reset = () => {
    e.status = 'idle';
    e.error = null;
    e.ready = false;
    e.started = false;
    e.cps = 0.5;
    e.onStatus = null;
    e.init.mockReset();
    e.evaluate.mockReset();
    e.stop.mockReset();
    e.panic.mockReset();
    e.setCps.mockReset();
    e.now.mockReset();
    e.queryTicks.mockReset();
    applyDefaults();
  };

  return e;
}

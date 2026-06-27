// ---------------------------------------------------------------------------
// Refrain audio engine — a thin wrapper over the *real* Strudel REPL
// (@strudel/web). Nothing about Strudel playback changes; we just hold the
// repl handle so the Cycle clock can read the scheduler and so edits can be
// auditioned and panicked safely.
// ---------------------------------------------------------------------------

import { SAMPLE_PACKS } from '../theme/tokens';

type Repl = {
  scheduler: {
    now: () => number;
    cps: number;
    started: boolean;
    pattern?: unknown;
  };
  evaluate: (code: string, autoplay?: boolean) => Promise<unknown>;
  start: () => void;
  stop: () => void;
  setCps: (cps: number) => void;
  state: { started: boolean; pattern?: unknown; error?: unknown };
};

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

class StrudelEngine {
  private repl: Repl | null = null;
  private transpile: ((code: string) => Promise<{ pattern: any }>) | null = null;
  status: EngineStatus = 'idle';
  error: string | null = null;
  private initPromise: Promise<boolean> | null = null;
  onStatus: ((s: EngineStatus, error?: string | null) => void) | null = null;

  private set(s: EngineStatus, err: string | null = null) {
    this.status = s;
    this.error = err;
    this.onStatus?.(s, err);
  }

  get ready() {
    return this.status === 'ready' && !!this.repl;
  }

  /** Idempotent. Resolves true when audio + samples are ready. */
  async init(): Promise<boolean> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        this.set('loading');
        const web = await import('@strudel/web');
        const { initStrudel, samples, registerSynthSounds, aliasBank } = web as any;

        const repl = await initStrudel({
          prebake: async () => {
            const ds = SAMPLE_PACKS.dough;
            const ts = SAMPLE_PACKS.todepond;
            try {
              await Promise.all([
                registerSynthSounds?.(),
                samples(`${ds}tidal-drum-machines.json`),
                samples(`${ds}piano.json`),
                samples(`${ds}Dirt-Samples.json`),
                samples(`${ds}EmuSP12.json`),
                samples(`${ds}vcsl.json`),
                samples(`${ds}mridangam.json`),
              ]);
              aliasBank?.(`${ts}tidal-drum-machines-alias.json`);
            } catch (e) {
              // Samples are best-effort — synth voices still sound offline.
              console.warn('[refrain] sample prebake partial:', e);
            }
          },
        });
        this.repl = repl as Repl;

        // a separate, non-playing evaluator for clock queries
        try {
          const t = await import('@strudel/transpiler');
          this.transpile = (code: string) => (t as any).evaluate(code);
        } catch {
          this.transpile = null;
        }

        this.set('ready');
        return true;
      } catch (e: any) {
        this.set('error', e?.message ?? String(e));
        return false;
      }
    })();
    return this.initPromise;
  }

  /** Evaluate code and (by default) play it on the shared scheduler. */
  async evaluate(code: string, autoplay = true): Promise<{ ok: boolean; error?: string }> {
    if (!this.repl) return { ok: false, error: 'engine not ready' };
    try {
      await this.repl.evaluate(code, autoplay);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: this.cleanError(e?.message ?? String(e)) };
    }
  }

  stop() {
    try {
      this.repl?.stop();
    } catch {
      /* noop */
    }
  }

  /** PANIC — hush all voices instantly. The transport (clock) keeps running. */
  async panic() {
    try {
      await this.repl?.evaluate('silence', true);
    } catch {
      this.repl?.stop();
    }
  }

  setCps(cps: number) {
    try {
      this.repl?.setCps(cps);
    } catch {
      /* noop */
    }
  }

  /** Fractional cycle position from the live scheduler. */
  now(): number {
    try {
      return this.repl?.scheduler.now() ?? 0;
    } catch {
      return 0;
    }
  }

  get cps(): number {
    return this.repl?.scheduler.cps ?? 0.5;
  }

  get started(): boolean {
    return !!this.repl?.scheduler.started;
  }

  /**
   * Query one cycle of a voice expression → event begin offsets in [0,1).
   * Used to lay ticks on the Cycle clock rings. Best-effort: a broken voice
   * just yields no ticks (it never reaches the speakers either).
   */
  async queryTicks(expr: string): Promise<number[]> {
    if (!this.transpile || !expr.trim()) return [];
    try {
      const { pattern } = await this.transpile(expr);
      if (!pattern || typeof pattern.queryArc !== 'function') return [];
      // Query a slightly wider arc so onsets nudged just before 0 (rubato) or
      // a late copy spilling past 1.0 (stretto) aren't lost, then fold each
      // begin back into [0,1) so it lands on the correct ring angle.
      const haps = pattern.queryArc(-0.0625, 1) as any[];
      const begins: number[] = haps
        .filter((h: any) => h?.whole && (h.hasOnset?.() ?? true))
        .map((h: any) => {
          const b = h.whole.begin;
          return typeof b?.valueOf === 'function' ? Number(b.valueOf()) : Number(b);
        })
        .filter((n: number) => !Number.isNaN(n))
        .map((n: number) => +(((n % 1) + 1) % 1).toFixed(4));
      const uniq: number[] = Array.from(new Set<number>(begins));
      return uniq.sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  private cleanError(msg: string): string {
    return msg.replace(/^Error:\s*/, '').replace(/\s*at\s+.*$/s, '').slice(0, 220);
  }
}

export const engine = new StrudelEngine();

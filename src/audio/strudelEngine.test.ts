import { describe, it, expect, vi } from 'vitest';
import { rmsPeak, engine, routeVoiceAnalysers } from './strudelEngine';

// Pure tier. Importing this module is safe: @strudel/web is only imported inside
// init(), so nothing here can touch Web Audio or build an AudioContext.
//
// These cover the A-12 instrumentation that makes the A2 release gate ("HUSH
// fades over one cycle without snapping back") measurable at all. The gate
// itself is NOT closed by this — a human still has to listen to the fade.

describe('rmsPeak', () => {
  it('reports peak and RMS of a symmetric square', () => {
    const { rms, peak } = rmsPeak(new Float32Array([0, 1, -1, 0]));
    expect(peak).toBe(1);
    expect(rms).toBeCloseTo(Math.sqrt(0.5), 5);
  });

  it('is zero for silence', () => {
    expect(rmsPeak(new Float32Array([0, 0, 0, 0]))).toEqual({ rms: 0, peak: 0 });
  });

  it('is zero for an empty buffer rather than NaN', () => {
    expect(rmsPeak(new Float32Array(0))).toEqual({ rms: 0, peak: 0 });
  });

  it('takes the absolute value for peak', () => {
    expect(rmsPeak(new Float32Array([-0.8, 0.2])).peak).toBeCloseTo(0.8, 5);
  });

  it('reports rms == peak for a constant signal', () => {
    const { rms, peak } = rmsPeak(new Float32Array([0.5, 0.5, 0.5, 0.5]));
    expect(rms).toBeCloseTo(0.5, 5);
    expect(peak).toBeCloseTo(0.5, 5);
  });

  it('falls with amplitude, so a fade is measurable', () => {
    const loud = rmsPeak(new Float32Array([1, -1, 1, -1])).rms;
    const quiet = rmsPeak(new Float32Array([0.1, -0.1, 0.1, -0.1])).rms;
    expect(quiet).toBeLessThan(loud);
  });
});

describe('sampleOutput on an uninitialised engine', () => {
  it('returns null instead of throwing or faking a zero reading', () => {
    // null distinguishes "no tap" from "silent" — a caller measuring a fade must
    // not mistake a missing analyser for real silence.
    expect(engine.sampleOutput()).toBeNull();
  });

  it('does not reach for the audio graph before a user gesture', () => {
    // The real hazard: getSuperdoughAudioController() lazily CONSTRUCTS an
    // AudioContext (superdough.mjs), and `web` is assigned before initStrudel()
    // resolves — so during the `loading` window the readiness guard is the only
    // thing standing between a sampleOutput() poke and a context built outside a
    // user gesture. Simulate that window and assert the controller is untouched.
    const controller = vi.fn(() => {
      throw new Error('getSuperdoughAudioController must not be called before ready');
    });
    const e = engine as unknown as { web: unknown; status: string };
    const web = e.web;
    const status = e.status;
    e.web = { getSuperdoughAudioController: controller };
    e.status = 'loading';
    try {
      expect(engine.ready).toBe(false);
      expect(engine.sampleOutput()).toBeNull();
      expect(controller).not.toHaveBeenCalled();
    } finally {
      e.web = web;
      e.status = status;
    }
  });
});

// Per-voice analyser routing — what makes the meters honest (A8). The old meters
// were driven by scheduled events, so a voice with events but no audio lit up
// anyway. Routing every voice through `.analyze('<id>')` gives each one a real
// tap, and superdough wires it as a SEND (analyser is a leaf), so it is
// inaudible and cannot double the signal.
describe('routeVoiceAnalysers', () => {
  it('appends a per-voice analyse tap to each voice, and reports which ids it routed', () => {
    const out = routeVoiceAnalysers('$drums: s("bd*2")\n$bass:  note("c2")');
    expect(out.code).toContain(".analyze('drums')");
    expect(out.code).toContain(".analyze('bass')");
    expect([...out.ids].sort()).toEqual(['bass', 'drums']);
  });

  it('taps the id, not the sigil — the id is what voiceLevel() looks up', () => {
    const out = routeVoiceAnalysers('$drums: s("bd*2")');
    expect(out.code).toContain(".analyze('drums')");
    expect(out.code).not.toContain(".analyze('$drums')");
  });

  it('keeps the tap inside the voice block, after its last chained line', () => {
    const out = routeVoiceAnalysers('$drums: s("bd*2")\n       .lpf(600)\n\n$bass: note("c2")');
    const lines = out.code.split('\n');
    // the tap must follow .lpf(600), still indented, so it chains onto $drums
    expect(lines[1]).toContain('.lpf(600)');
    expect(lines[2].trim()).toBe(".analyze('drums')");
    expect(lines[2]).toMatch(/^\s+\./);
  });

  it('never double-wraps a voice that is already routed', () => {
    const once = routeVoiceAnalysers('$drums: s("bd*2")');
    const twice = routeVoiceAnalysers(once.code);
    expect(twice.code).toBe(once.code);
    expect(twice.code.match(/\.analyze\(/g)).toHaveLength(1);
    expect(twice.ids).toEqual([]); // nothing newly routed
  });

  // `.analyze(` in a COMMENT is not a tap. Treating it as one skipped the voice
  // and silently dropped the whole app back to event-driven metering.
  it('routes a voice whose only .analyze( is inside a comment', () => {
    const out = routeVoiceAnalysers('$drums: s("bd*2") // .analyze(x) one day');
    expect(out.ids).toEqual(['drums']);
    expect(out.code).toContain(".analyze('drums')");
  });

  it('skips a silenced voice — a muted voice has no audio to tap', () => {
    const out = routeVoiceAnalysers('$drums: silence\n$bass: note("c2")');
    expect(out.code).not.toContain(".analyze('drums')");
    expect(out.code).toContain(".analyze('bass')");
    expect(out.ids).toEqual(['bass']);
  });

  it('leaves code with no voices untouched', () => {
    expect(routeVoiceAnalysers('silence').code).toBe('silence');
    expect(routeVoiceAnalysers('').code).toBe('');
  });

  // `parseScore` ends a voice block at the first column-0 line, so a chain whose
  // closing paren is unindented leaves `expr` mid-argument-list. Appending a tap
  // there produced a SYNTAX ERROR, which made evaluate() retry unrouted and
  // dropped EVERY meter back to onset envelopes — the original A8 dishonesty,
  // triggered by one awkward voice.
  it('skips a voice whose chain would not parse with the tap attached, and still routes the others', () => {
    const score = '$drums: stack(\n  s("bd*2"),\n  s("hh*4"),\n)\n$bass: note("c2")';
    const out = routeVoiceAnalysers(score);
    expect(out.ids).toEqual(['bass']); // drums skipped, bass still measured
    expect(out.code).not.toContain(".analyze('drums')");
    expect(out.code).toContain(".analyze('bass')");
  });

  // Worse than the syntax error, because nothing signals it: the tap binds to one
  // inner sub-expression, so the voice meters only PART of itself (the kick
  // vanishes from $drums' level) while claiming to be measured.
  it('skips a voice whose tap would bind to an inner sub-expression rather than the whole chain', () => {
    const score = '$drums: stack(\n  s("bd*2"),\n  s("hh*4")\n)';
    const out = routeVoiceAnalysers(score);
    expect(out.ids).toEqual([]);
    expect(out.code).toBe(score); // untouched rather than half-tapped
  });

  // HUSH splices `.postgain(saw.range(1, 0).slow(1))` onto each voice before the
  // engine sees it. The tap must land after that, leaving the fade intact.
  it('composes with the HUSH fade rather than breaking it', () => {
    const faded = '$drums: s("bd*2")\n       .postgain(saw.range(1, 0).slow(1))';
    const out = routeVoiceAnalysers(faded);
    expect(out.code).toContain('.postgain(saw.range(1, 0).slow(1))');
    expect(out.code.indexOf(".analyze('drums')")).toBeGreaterThan(out.code.indexOf('.postgain('));
    expect(out.ids).toEqual(['drums']);
  });
});

// voiceLevel must distinguish "silent" (0) from "cannot know" (null), or the
// meters cannot fall back honestly. These drive the engine through a fake repl:
// asserting a null on an UNINITIALISED engine proves nothing, because the
// `getAnalyserById` lookup would return null on its own — the guard under test
// has to be reached with a tap genuinely available.
describe('voiceLevel', () => {
  const fakeAnalyser = (peak: number) => ({
    fftSize: 8192,
    getFloatTimeDomainData: (buf: Float32Array) => {
      buf.fill(0);
      buf[0] = peak;
    },
  });

  /** A ready engine whose `getAnalyserById` always yields a loud tap. */
  function armEngine() {
    const e = engine as any;
    e.status = 'ready';
    e.repl = { evaluate: async () => undefined, scheduler: { now: () => 0, cps: 0.5, started: true }, state: {} };
    e.web = { getAnalyserById: () => fakeAnalyser(0.9) };
    e.voiceTaps = new Map();
    e.voiceBufs = new Map();
    return e;
  }

  it('returns null rather than a fake zero when the engine is not ready', () => {
    const e = armEngine();
    e.routedIds = new Set(['drums']); // a tap IS available for this voice
    e.status = 'idle'; // ...but the engine is not ready
    expect(engine.ready).toBe(false);
    expect(engine.voiceLevel('drums')).toBeNull();
  });

  // The honesty guard: an unrouted voice must read null ("cannot know"), never a
  // reading from someone else's tap or a fabricated zero.
  it('returns null for a voice the last evaluate did not route', () => {
    const e = armEngine();
    e.routedIds = new Set(['bass']);
    expect(engine.voiceLevel('bass')).not.toBeNull(); // routed → real reading
    expect(engine.voiceLevel('drums')).toBeNull(); // not routed → cannot know
  });

  it('reads the real tap for a routed voice', () => {
    const e = armEngine();
    e.routedIds = new Set(['drums']);
    const lvl = engine.voiceLevel('drums');
    expect(lvl).not.toBeNull();
    expect(lvl!.peak).toBeCloseTo(0.9, 5);
  });
});

// The wiring is the whole point: `routeVoiceAnalysers` being correct as a pure
// function means nothing if evaluate() never calls it. These drive evaluate()
// through a fake repl and assert what actually reached the scheduler.
describe('evaluate routes voices through their analysers', () => {
  /** A ready engine with a recording fake repl. `fail` rejects matching code. */
  function armEngine(fail?: (code: string) => boolean) {
    const e = engine as any;
    const sent: string[] = [];
    e.status = 'ready';
    e.routedIds = new Set<string>();
    e.voiceTaps = new Map();
    e.voiceBufs = new Map();
    e.web = {
      getAnalyserById: () => ({
        fftSize: 8192,
        getFloatTimeDomainData: (buf: Float32Array) => {
          buf.fill(0);
          buf[0] = 0.7;
        },
      }),
    };
    e.repl = {
      evaluate: async (code: string) => {
        sent.push(code);
        if (fail?.(code)) throw new Error('boom');
        return undefined;
      },
      scheduler: { now: () => 0, cps: 0.5, started: true },
      state: {},
      start: () => {},
      stop: () => {},
      setCps: () => {},
    };
    return { e, sent };
  }

  it('sends the ROUTED code to the scheduler, not the raw score', async () => {
    const { sent } = armEngine();
    await engine.evaluate('$drums: s("bd*2")\n$bass: note("c2")');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(".analyze('drums')");
    expect(sent[0]).toContain(".analyze('bass')");
  });

  it('makes those voices readable afterwards — the tap is live, not just textual', async () => {
    armEngine();
    await engine.evaluate('$drums: s("bd*2")');
    expect(engine.voiceLevel('drums')).not.toBeNull();
    expect(engine.voiceLevel('nosuch')).toBeNull();
  });

  // Metering must never be able to take the audio down with it.
  it('retries the ORIGINAL verbatim when the routed code fails, and stops claiming to measure', async () => {
    const { sent } = armEngine((code) => code.includes('.analyze('));
    const res = await engine.evaluate('$drums: s("bd*2")');
    expect(res.ok).toBe(true); // audio survived
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toContain('.analyze('); // the user's code, unrouted
    // and the flag must not claim routing that did not happen
    expect(engine.voiceLevel('drums')).toBeNull();
  });

  it('reports the real error when the unrouted retry also fails', async () => {
    const { sent } = armEngine(() => true);
    const res = await engine.evaluate('$drums: s("bd*2")');
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(2);
  });
});

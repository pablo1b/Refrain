import { describe, it, expect, vi } from 'vitest';
import { rmsPeak, engine } from './strudelEngine';

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

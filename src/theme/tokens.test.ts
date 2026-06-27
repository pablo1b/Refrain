import { describe, it, expect } from 'vitest';
import {
  colorForVoice,
  cssVar,
  VOICE_COLORS,
  VOICE_RING,
  CLOCK_RINGS,
  SAMPLE_PACKS,
} from './tokens';

// Pure-logic tier: token tables + the deterministic colour-ring fallback are
// read by SVG/canvas code where CSS vars are awkward, so the mapping must be
// exact. cssVar's real themed values need a real browser (covered in the
// browser tier); here we only pin its happy-dom empty-string behaviour.

describe('colorForVoice', () => {
  it.each([
    ['drums', '#6AA0FF'],
    ['hats', '#C7F24A'],
    ['bass', '#C58CF2'],
    ['pad', '#5FD3B0'],
  ])('maps known voice %s to its VOICE_COLORS value', (id, expected) => {
    // index is irrelevant when the id is a known voice
    expect(colorForVoice(id, 0)).toBe(expected);
    expect(colorForVoice(id, 99)).toBe(expected);
  });

  it('falls back to VOICE_RING[index] for an unknown id at index 0', () => {
    expect(colorForVoice('mystery', 0)).toBe(VOICE_RING[0]);
  });

  it('wraps the ring modulo its length: index 8 returns ring[0]', () => {
    expect(colorForVoice('mystery', 8)).toBe(VOICE_RING[0]);
  });

  it('wraps the ring modulo its length: index 9 returns ring[1]', () => {
    expect(colorForVoice('mystery', 9)).toBe(VOICE_RING[1]);
  });
});

describe('VOICE_RING', () => {
  it('has exactly 8 entries', () => {
    expect(VOICE_RING).toHaveLength(8);
  });
});

describe('CLOCK_RINGS', () => {
  it('is a strictly descending number array', () => {
    expect(CLOCK_RINGS).toEqual([80, 62, 44, 26, 14]);
    for (let i = 1; i < CLOCK_RINGS.length; i++) {
      expect(CLOCK_RINGS[i]).toBeLessThan(CLOCK_RINGS[i - 1]);
    }
  });
});

describe('SAMPLE_PACKS', () => {
  it('exposes dough + todepond raw-github URL strings', () => {
    expect(SAMPLE_PACKS.dough).toBe(
      'https://raw.githubusercontent.com/felixroos/dough-samples/main/',
    );
    expect(SAMPLE_PACKS.todepond).toBe(
      'https://raw.githubusercontent.com/todepond/samples/main/',
    );
  });
});

describe('cssVar', () => {
  it('returns an empty string for an unset property in happy-dom', () => {
    expect(cssVar('--definitely-not-set')).toBe('');
  });
});

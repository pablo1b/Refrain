import { describe, it, expect } from 'vitest';
import { buildLanes } from './lanes';

// Pure-logic tier: no mocks, no DOM. buildLanes is a deterministic template
// picker. Lane.id is Date.now-based, so we only ever assert on shape/content
// (labels, voiceIds, code), never on the id itself.

const GEN_PROMPT = 'add a melody on top';
const DROP_PROMPT = 'big drop into the chorus';

describe('buildLanes', () => {
  it('returns exactly three lanes labelled A, B, C', () => {
    const lanes = buildLanes(GEN_PROMPT, []);
    expect(lanes).toHaveLength(3);
    expect(lanes.map((l) => l.label)).toEqual(['A', 'B', 'C']);
  });

  it('uses the drop templates for a drop/build/peak prompt', () => {
    const lanes = buildLanes(DROP_PROMPT, []);
    expect(lanes.map((l) => l.name)).toEqual(['filter sweep', 'snare roll', 'silence → hit']);
  });

  it.each([
    'build it up',
    'add a riser',
    'drum fill here',
    'the peak of the track',
    'climax energy',
    'make it intense',
    'hard hitting',
  ])('treats %s as a drop prompt', (prompt) => {
    const lanes = buildLanes(prompt, []);
    expect(lanes.map((l) => l.name)).toEqual(['filter sweep', 'snare roll', 'silence → hit']);
  });

  it('uses the generic templates for a plain prompt', () => {
    const lanes = buildLanes(GEN_PROMPT, []);
    expect(lanes.map((l) => l.name)).toEqual(['rising arp', 'pulse bass', 'shaker texture']);
  });

  it('emits the expected drop voice ids and shapes', () => {
    const lanes = buildLanes(DROP_PROMPT, []);
    expect(lanes.map((l) => l.voiceId)).toEqual(['fx', 'rl', 'gp']);
    expect(lanes.map((l) => l.shape)).toEqual(['sweep', 'roll', 'gap']);
  });

  it('emits the expected generic voice ids and shapes', () => {
    const lanes = buildLanes(GEN_PROMPT, []);
    expect(lanes.map((l) => l.voiceId)).toEqual(['arp', 'pls', 'tex']);
    expect(lanes.map((l) => l.shape)).toEqual(['rise', 'roll', 'flat']);
  });

  it('prefixes each lane.code with $<voiceId>: and the template expression', () => {
    const lanes = buildLanes(GEN_PROMPT, []);
    expect(lanes[0].code).toBe('$arp: note("c4 eb4 g4 bb4").s("triangle").fast(2).gain(0.45)');
    expect(lanes[1].code).toBe('$pls: note("c2*4").s("sawtooth").lpf(700).gain(0.55)');
    expect(lanes[2].code).toBe('$tex: s("hh*16").gain(perlin.range(0.08, 0.4)).pan(sine.range(0.2, 0.8))');
  });

  it('renders the deterministic drop expressions with variant 0', () => {
    const lanes = buildLanes(DROP_PROMPT, []);
    expect(lanes[0].code).toBe('$fx: s("white").lpf(sine.range(200, 6000).slow(2)).gain(0.45)');
    expect(lanes[1].code).toBe('$rl: s("sd*[8 12]").gain(saw.range(0.35, 1)).bank("RolandTR909")');
    expect(lanes[2].code).toBe('$gp: s("~@3 crash").gain(0.9)');
  });

  it('starts every lane.code with its own $<voiceId>: sigil', () => {
    const lanes = buildLanes(GEN_PROMPT, []);
    for (const l of lanes) {
      expect(l.code.startsWith(`$${l.voiceId}: `)).toBe(true);
    }
  });

  it('dedupes a voiceId that collides with an existing voice', () => {
    const lanes = buildLanes(DROP_PROMPT, ['fx']);
    // 'fx' is taken → first lane bumps to 'fx1'; siblings are unaffected.
    expect(lanes[0].voiceId).toBe('fx1');
    expect(lanes[0].code.startsWith('$fx1: ')).toBe(true);
    expect(lanes.map((l) => l.voiceId)).toEqual(['fx1', 'rl', 'gp']);
  });

  it('never lets sibling lanes share a voiceId', () => {
    // Force collisions across every base voice so dedup must work per-sibling.
    const lanes = buildLanes(DROP_PROMPT, ['fx', 'rl', 'gp']);
    const ids = lanes.map((l) => l.voiceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['fx1', 'rl1', 'gp1']);
  });

  it('reroll=true still yields three well-formed lanes', () => {
    const lanes = buildLanes(DROP_PROMPT, [], true);
    expect(lanes).toHaveLength(3);
    expect(lanes.map((l) => l.label)).toEqual(['A', 'B', 'C']);
    for (const l of lanes) {
      // shape/content only — reroll changes the variant, so codes differ.
      expect(l.code.startsWith(`$${l.voiceId}: `)).toBe(true);
      expect(l.name).toBeTruthy();
      expect(l.voiceId).toBeTruthy();
    }
    const ids = lanes.map((l) => l.voiceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

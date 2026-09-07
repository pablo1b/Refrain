import { describe, it, expect } from 'vitest';
import { buildLanes, laneBody, laneDraft, refineLaneDraft, fmtNum } from './lanes';

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

  it('prefixes each lane.code with $<voiceId>: and the seed-0 template expression', () => {
    // seed 0: template order unchanged; lane i takes variant (0+i)%3.
    const lanes = buildLanes(GEN_PROMPT, [], 0);
    expect(lanes[0].code).toBe('$arp: note("c4 eb4 g4 bb4").s("triangle").fast(2).gain(0.45)');
    expect(lanes[1].code).toBe('$pls: note("c2*4").s("sawtooth").lpf(1000).gain(0.55)');
    expect(lanes[2].code).toBe('$tex: s("hh*16").gain(perlin.range(0.08, 0.4)).pan(sine.range(0.2, 0.8))');
  });

  it('renders the deterministic drop expressions at seed 0', () => {
    const lanes = buildLanes(DROP_PROMPT, [], 0);
    expect(lanes[0].code).toBe('$fx: s("white").lpf(sine.range(200, 6000).slow(2)).gain(0.45)');
    expect(lanes[1].code).toBe('$rl: s("sd*[8 16]").gain(saw.range(0.35, 1)).bank("RolandTR909")');
    expect(lanes[2].code).toBe('$gp: s("~@3 crash").gain(0.9)');
  });

  it('is reproducible: the same seed yields identical fork code', () => {
    const a = buildLanes(DROP_PROMPT, [], 0x4f2a);
    const b = buildLanes(DROP_PROMPT, [], 0x4f2a);
    expect(a.map((l) => l.code)).toEqual(b.map((l) => l.code));
  });

  it('a different seed rotates the template set (wanders)', () => {
    const a = buildLanes(DROP_PROMPT, [], 0);
    const b = buildLanes(DROP_PROMPT, [], 1); // offset 1 → different first template
    expect(a[0].name).not.toBe(b[0].name);
  });

  it('follows the requested count (2–4) from the prompt', () => {
    expect(buildLanes('give me two ideas', [])).toHaveLength(2);
    expect(buildLanes('4 ways into the drop', [])).toHaveLength(4);
    expect(buildLanes('some variations', [])).toHaveLength(3); // default
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

  it('a fresh seed still yields well-formed, uniquely-named lanes', () => {
    const lanes = buildLanes(DROP_PROMPT, [], 7);
    expect(lanes).toHaveLength(3);
    expect(lanes.map((l) => l.label)).toEqual(['A', 'B', 'C']);
    for (const l of lanes) {
      // shape/content only — a new seed changes the variant, so codes differ.
      expect(l.code.startsWith(`$${l.voiceId}: `)).toBe(true);
      expect(l.name).toBeTruthy();
      expect(l.voiceId).toBeTruthy();
    }
    const ids = lanes.map((l) => l.voiceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// A-11 — generated numbers are formatted at emission. The seed-0 literals above
// are provably unaffected (they interpolate integers only); the two cases below
// are the DELIBERATE re-baseline for the float sites that used to leak IEEE
// noise into the committed score.
// ---------------------------------------------------------------------------
describe('fmtNum (A-11)', () => {
  it.each([
    [0.2 + 0.1, '0.3'],
    [1.4 + 0.4, '1.8'],
    [6000, '6000'],
    [2, '2'],
    [-0.5, '-0.5'],
    [0.30000000000000004, '0.3'],
  ])('formats %s as %s', (input, expected) => {
    expect(fmtNum(input as number)).toBe(expected);
  });
});

describe('generated numbers carry no float noise (A-11)', () => {
  it('emits .room(0.3), not .room(0.30000000000000004)', () => {
    // seed 7 → lane A takes the "chord stab" template at variant 1
    const lanes = buildLanes(GEN_PROMPT, [], 7);
    expect(lanes[0].code).toBe(
      '$stab: chord("<Cm7 Fm9>").voicing().s("sawtooth").struct("t ~ t ~").room(0.3)',
    );
  });

  it('emits .distort("1.8:0.4"), not 1.7999999999999998', () => {
    const lanes = buildLanes(DROP_PROMPT, [], 7);
    expect(lanes[0].code).toBe('$st: note("c2").s("sawtooth").struct("t ~ ~ ~").distort("1.8:0.4")');
  });

  it('never emits a long float tail for any seed or prompt', () => {
    for (const prompt of [GEN_PROMPT, DROP_PROMPT, '4 ways into the drop']) {
      for (let seed = 0; seed < 24; seed++) {
        for (const l of buildLanes(prompt, [], seed)) {
          expect(l.code).not.toMatch(/\d\.\d{7,}/);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A lane exists to be AUDITIONED — you solo it against the mix. The "chord
// stab" archetype emitted `note("<Cm7 Fm9>")`, which renders silence (the note
// value is the literal string "Cm7"), so a quarter of the pool could never be
// heard. Chord symbols must go through `.voicing()`.
// ---------------------------------------------------------------------------
describe('every generated lane can actually sound', () => {
  it('never puts a chord symbol inside note(), for any seed or prompt', () => {
    for (const prompt of [GEN_PROMPT, DROP_PROMPT, '4 ways into the drop']) {
      for (let seed = 0; seed < 24; seed++) {
        for (const l of buildLanes(prompt, [], seed)) {
          expect(l.code).not.toMatch(/note\(\s*"<?[A-G][#b]?(m|maj|min|M|\^|dim|aug|sus|add|alt|[0-9])/);
        }
      }
    }
  });

  it('voices the chord-stab archetype through chord().voicing()', () => {
    const stab = buildLanes(GEN_PROMPT, [], 7)[0].code;
    expect(stab).toContain('chord("<Cm7 Fm9>").voicing()');
  });
});

// ---------------------------------------------------------------------------
// A-6 — a lane's body is identified by ONE integer key, so refine can search
// deterministically for content that is not already on screen.
// ---------------------------------------------------------------------------
describe('laneBody', () => {
  it('strips the $voice: prefix', () => {
    expect(laneBody('$x: s("bd")')).toBe('s("bd")');
  });

  it('tolerates leading whitespace and extra spacing', () => {
    expect(laneBody('   $my_voice:   s("bd")')).toBe('s("bd")');
  });

  it('leaves a bare expression alone', () => {
    expect(laneBody('s("bd")')).toBe('s("bd")');
  });
});

describe('laneDraft / variantKey (A-6)', () => {
  it('gives lane i the key seed+i', () => {
    const lanes = buildLanes(GEN_PROMPT, [], 0x4f2a);
    expect(lanes.map((l) => l.variantKey)).toEqual([0x4f2a, 0x4f2b, 0x4f2c]);
  });

  it('is 12-periodic — the collision law', () => {
    for (const k of [0, 1, 5, 7, 0xe824]) {
      expect(laneDraft(GEN_PROMPT, k).body).toBe(laneDraft(GEN_PROMPT, k + 12).body);
      expect(laneDraft(DROP_PROMPT, k).body).toBe(laneDraft(DROP_PROMPT, k + 12).body);
    }
  });

  it('produces 10 distinct bodies across one period', () => {
    // 4 templates x 3 variants = 12 keys, but two templates ignore the variant
    // ("silence → hit", "shaker texture"), so their three keys collapse to one
    // body each: 3 + 3 + 1 + 3 = 10. Still far more than the 4 lanes that can be
    // on screen at once, which is what makes the refine search always succeed.
    const bodies = new Set(Array.from({ length: 12 }, (_, k) => laneDraft(GEN_PROMPT, k).body));
    expect(bodies.size).toBe(10);
    expect(bodies.size).toBeGreaterThan(4);
  });

  it('has more distinct bodies than the maximum lanes on screen, for both pools', () => {
    for (const prompt of [GEN_PROMPT, DROP_PROMPT]) {
      const bodies = new Set(Array.from({ length: 12 }, (_, k) => laneDraft(prompt, k).body));
      expect(bodies.size).toBeGreaterThan(4);
    }
  });

  it('matches what buildLanes emits for the same key', () => {
    const lanes = buildLanes(GEN_PROMPT, [], 7);
    expect(laneBody(lanes[0].code)).toBe(laneDraft(GEN_PROMPT, 7).body);
  });

  it('is stable for a negative key', () => {
    expect(() => laneDraft(GEN_PROMPT, -5)).not.toThrow();
    expect(laneDraft(GEN_PROMPT, -5).body).toBe(laneDraft(GEN_PROMPT, 7).body);
  });
});

describe('refineLaneDraft (A-6)', () => {
  it('returns a body that is not in the avoid list', () => {
    const avoid = buildLanes(GEN_PROMPT, [], 0).map((l) => laneBody(l.code));
    const draft = refineLaneDraft(GEN_PROMPT, 1, avoid);
    expect(avoid).not.toContain(draft.body);
  });

  it('is deterministic across two identical calls', () => {
    const avoid = buildLanes(GEN_PROMPT, [], 0).map((l) => laneBody(l.code));
    expect(refineLaneDraft(GEN_PROMPT, 1, avoid).body).toBe(refineLaneDraft(GEN_PROMPT, 1, avoid).body);
  });

  it('advances the key rather than standing still', () => {
    const avoid = [laneDraft(GEN_PROMPT, 3).body];
    expect(refineLaneDraft(GEN_PROMPT, 3, avoid).variantKey).toBeGreaterThan(3);
  });

  it('returns the fromKey draft when nothing is avoided', () => {
    expect(refineLaneDraft(GEN_PROMPT, 5, []).variantKey).toBe(5);
  });

  it('never reproduces a visible sibling for the reported seed 0xE824', () => {
    // The exact regression: refining lane A used to regenerate with seed+idx+1
    // and then take index idx, which for idx=0 is always sibling B's key.
    const lanes = buildLanes(GEN_PROMPT, [], 0xe824);
    const bodies = lanes.map((l) => laneBody(l.code));
    const refined = refineLaneDraft(GEN_PROMPT, (lanes[0].variantKey ?? 0) + 1, bodies);
    expect(bodies).not.toContain(refined.body);
  });
});

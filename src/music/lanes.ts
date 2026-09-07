// ---------------------------------------------------------------------------
// Variation lanes (spec §07.2 / Shape 02). Generation never overwrites: the
// Maestro returns 2–4 forks, each a new named voice with real, audible Strudel
// you can solo against the mix, refine, and commit. Deterministic templates
// keep this working offline; the snippets are valid patterns.
// ---------------------------------------------------------------------------

import type { Lane, LaneShape } from '../types';

/**
 * Format a generated number for emission: trims IEEE noise (0.2 + 0.1 → "0.3")
 * WITHOUT touching the seed maths. Rounding a value that feeds the variant
 * selection would change the draw sequence and break seed reproducibility, so
 * this is applied at the point a number becomes STRING and nowhere else (A-11).
 */
export function fmtNum(x: number): string {
  return String(+x.toFixed(4));
}

let laneCounter = 0;
const lid = () => `ln${Date.now().toString(36)}${(laneCounter++).toString(36)}`;

interface Template {
  name: string;
  voice: string; // base voice id
  shape: LaneShape;
  desc: string;
  expr: (variant: number) => string;
}

const DROP_TEMPLATES: Template[] = [
  {
    name: 'filter sweep',
    voice: 'fx',
    shape: 'sweep',
    desc: '2 bars',
    expr: (v) => `s("white").lpf(sine.range(200, ${fmtNum(6000 + v * 1500)}).slow(2)).gain(0.45)`,
  },
  {
    name: 'snare roll',
    voice: 'rl',
    shape: 'roll',
    desc: '1 bar',
    expr: (v) => `s("sd*[8 ${fmtNum(12 + v * 4)}]").gain(saw.range(0.35, 1)).bank("RolandTR909")`,
  },
  {
    name: 'silence → hit',
    voice: 'gp',
    shape: 'gap',
    desc: '1 bar',
    expr: () => `s("~@3 crash").gain(0.9)`,
  },
  {
    name: 'distortion stab',
    voice: 'st',
    shape: 'rise',
    desc: '2 bars',
    expr: (v) => `note("c2").s("sawtooth").struct("t ~ ~ ~").distort("${fmtNum(1.4 + v * 0.4)}:0.4")`,
  },
];

const GEN_TEMPLATES: Template[] = [
  {
    name: 'rising arp',
    voice: 'arp',
    shape: 'rise',
    desc: '1 bar',
    expr: (v) => `note("c4 eb4 g4 bb4").s("triangle").fast(${fmtNum(2 + v)}).gain(0.45)`,
  },
  {
    name: 'pulse bass',
    voice: 'pls',
    shape: 'roll',
    desc: '1 bar',
    expr: (v) => `note("c2*4").s("sawtooth").lpf(${fmtNum(700 + v * 300)}).gain(0.55)`,
  },
  {
    name: 'shaker texture',
    voice: 'tex',
    shape: 'flat',
    desc: '1 bar',
    expr: () => `s("hh*16").gain(perlin.range(0.08, 0.4)).pan(sine.range(0.2, 0.8))`,
  },
  {
    name: 'chord stab',
    voice: 'stab',
    shape: 'gap',
    desc: '2 bars',
    // chord symbols only reach pitch through `.voicing()` — `note("<Cm7 …>")`
    // emits the literal symbol as the note value and renders silence.
    expr: (v) =>
      `chord("<Cm7 Fm9>").voicing().s("sawtooth").struct("t ~ t ~").room(${fmtNum(0.2 + v * 0.1)})`,
  },
];

const WORD_NUM: Record<string, number> = { two: 2, three: 3, four: 4 };

/** Drop/build prompts get the riser pool; everything else the generic one. */
function poolFor(prompt: string): Template[] {
  const lower = prompt.toLowerCase();
  const dropish = /\b(drop|build|hard|riser|fill|peak|climax|energy|intense)\b/.test(lower);
  return dropish ? DROP_TEMPLATES : GEN_TEMPLATES;
}

/**
 * A lane's musical content is identified by ONE integer key: the template is
 * `key mod pool-length` and the variant is `key mod 3`. Two lanes therefore
 * collide iff their keys agree modulo lcm(4, 3) = 12. `buildLanes` gives lane
 * `i` the key `seed + i`; refine walks the key forward until the body is unlike
 * everything already on screen (A-6).
 */
export interface LaneDraft {
  name: string;
  desc: string;
  shape: LaneShape;
  voice: string; // base voice id, before collision-dedup
  body: string; // the expression WITHOUT the `$voice: ` prefix
  variantKey: number; // the key that produced this body
}

/** The expression of a `$voice: expr` line, without the sigil prefix. */
export function laneBody(code: string): string {
  return code.replace(/^\s*\$[^:]+:\s*/, '');
}

/** The lane content for one key — pure, no RNG, no counter. */
export function laneDraft(prompt: string, key: number): LaneDraft {
  const pool = poolFor(prompt);
  const t = pool[((key % pool.length) + pool.length) % pool.length];
  const variant = ((key % 3) + 3) % 3;
  return { name: t.name, desc: t.desc, shape: t.shape, voice: t.voice, body: t.expr(variant), variantKey: key };
}

/**
 * The next lane content that is NOT already on screen. Deterministic: a pure
 * function of (prompt, fromKey, avoid). 12 distinct bodies exist per pool and at
 * most 4 lanes are ever visible, so the search always succeeds; the trailing
 * return is an unreachable-but-honest fallback rather than a throw.
 */
export function refineLaneDraft(prompt: string, fromKey: number, avoid: string[], attempts = 12): LaneDraft {
  for (let a = 0; a < attempts; a++) {
    const d = laneDraft(prompt, fromKey + a);
    if (!avoid.includes(d.body)) return d;
  }
  return laneDraft(prompt, fromKey);
}

/** How many lanes to offer: 2–4, following the request (spec §10). */
export function laneCount(prompt: string): number {
  const lower = prompt.toLowerCase();
  const digit = lower.match(/\b([2-9])\b/);
  if (digit) return Math.min(4, Math.max(2, parseInt(digit[1], 10)));
  for (const [w, n] of Object.entries(WORD_NUM)) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) return n;
  }
  return 3;
}

/**
 * Build 2–4 variation lanes for a prompt. `seed` (a visible 16-bit value, spec
 * §07) makes generation reproducible: the same seed always yields the same
 * forks; a nudged seed rotates the template set + variant so it wanders one step.
 */
export function buildLanes(prompt: string, existingIds: string[], seed = 0): Lane[] {
  const n = laneCount(prompt);
  const labels = ['A', 'B', 'C', 'D'];
  const used = new Set(existingIds);

  const lanes: Lane[] = [];
  for (let i = 0; i < n; i++) {
    // lane i is keyed seed+i — the same rotation-by-seed as before, expressed as
    // the one integer that identifies the content (A-6).
    const d = laneDraft(prompt, seed + i);
    // never collide with an existing voice (or with another fork)
    let voiceId = d.voice;
    let k = 1;
    while (used.has(voiceId)) voiceId = `${d.voice}${k++}`;
    used.add(voiceId);
    lanes.push({
      id: lid(),
      label: labels[i],
      name: d.name,
      desc: d.desc,
      voiceId,
      shape: d.shape,
      code: `$${voiceId}: ${d.body}`,
      variantKey: d.variantKey,
    } satisfies Lane);
  }
  return lanes;
}

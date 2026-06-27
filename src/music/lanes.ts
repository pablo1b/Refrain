// ---------------------------------------------------------------------------
// Variation lanes (spec §07.2 / Shape 02). Generation never overwrites: the
// Maestro returns 2–4 forks, each a new named voice with real, audible Strudel
// you can solo against the mix, refine, and commit. Deterministic templates
// keep this working offline; the snippets are valid patterns.
// ---------------------------------------------------------------------------

import type { Lane, LaneShape } from '../types';

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
    expr: (v) => `s("white").lpf(sine.range(200, ${6000 + v * 1500}).slow(2)).gain(0.45)`,
  },
  {
    name: 'snare roll',
    voice: 'rl',
    shape: 'roll',
    desc: '1 bar',
    expr: (v) => `s("sd*[8 ${12 + v * 4}]").gain(saw.range(0.35, 1)).bank("RolandTR909")`,
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
    expr: (v) => `note("c2").s("sawtooth").struct("t ~ ~ ~").distort("${1.4 + v * 0.4}:0.4")`,
  },
];

const GEN_TEMPLATES: Template[] = [
  {
    name: 'rising arp',
    voice: 'arp',
    shape: 'rise',
    desc: '1 bar',
    expr: (v) => `note("c4 eb4 g4 bb4").s("triangle").fast(${2 + v}).gain(0.45)`,
  },
  {
    name: 'pulse bass',
    voice: 'pls',
    shape: 'roll',
    desc: '1 bar',
    expr: (v) => `note("c2*4").s("sawtooth").lpf(${700 + v * 300}).gain(0.55)`,
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
    expr: (v) => `note("<Cm7 Fm9>").s("sawtooth").struct("t ~ t ~").room(${0.2 + v * 0.1})`,
  },
];

export function buildLanes(prompt: string, existingIds: string[], reroll = false): Lane[] {
  const lower = prompt.toLowerCase();
  const dropish = /\b(drop|build|hard|riser|fill|peak|climax|energy|intense)\b/.test(lower);
  const templates = dropish ? DROP_TEMPLATES : GEN_TEMPLATES;
  const n = 3; // spec figure shows three lanes
  const variant = reroll ? 1 + (laneCounter % 2) : 0;
  const labels = ['A', 'B', 'C', 'D'];
  const used = new Set(existingIds);

  return templates.slice(0, n).map((t, i) => {
    // never collide with an existing voice (or with another fork)
    let voiceId = t.voice;
    let k = 1;
    while (used.has(voiceId)) voiceId = `${t.voice}${k++}`;
    used.add(voiceId);
    return {
      id: lid(),
      label: labels[i],
      name: t.name,
      desc: t.desc,
      voiceId,
      shape: t.shape,
      code: `$${voiceId}: ${t.expr(variant + i * 0)}`,
    } satisfies Lane;
  });
}

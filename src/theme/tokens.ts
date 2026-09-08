// ---------------------------------------------------------------------------
// Tokens that need to be readable from JS/SVG (where CSS vars are awkward).
// Voice colours are intentionally close to theme-stable; the *live* lime is
// the one colour that shifts between themes, so we resolve it from CSS.
// ---------------------------------------------------------------------------

/** Ordered voice palette. Index 1 (hats) is the "live lime" slot. */
export const VOICE_COLORS: Record<string, string> = {
  drums: '#6AA0FF',
  hats: '#C7F24A',
  bass: '#C58CF2',
  pad: '#5FD3B0',
};

/** Deterministic colour ring for any extra/unknown voices. */
export const VOICE_RING = [
  '#6AA0FF', // blue
  '#C7F24A', // lime
  '#C58CF2', // purple
  '#5FD3B0', // teal
  '#F2A007', // amber
  '#E0A75C', // sand
  '#6FE0E0', // cyan
  '#F28DB2', // rose
];

export function colorForVoice(id: string, index: number): string {
  return VOICE_COLORS[id] ?? VOICE_RING[index % VOICE_RING.length];
}

/** Read a CSS custom property off <html> at runtime (theme-aware). */
export function cssVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Cycle-clock geometry: ring radii from outer→inner, matching Fig 4.1 / 5.x.
export const CLOCK_RINGS = [80, 62, 44, 26, 14];

export const SAMPLE_PACKS = {
  dough: 'https://raw.githubusercontent.com/felixroos/dough-samples/main/',
  todepond: 'https://raw.githubusercontent.com/todepond/samples/main/',
};

/** The sample-pack JSON manifests the engine prebakes (single source of truth). */
export const SAMPLE_JSON = [
  'tidal-drum-machines.json',
  'piano.json',
  'Dirt-Samples.json',
  'EmuSP12.json',
  'vcsl.json',
  'mridangam.json',
];

/** Display names for the loaded packs — what the Shelf PACKS tab shows. */
export const LOADED_PACKS = ['tidal-drum-machines', 'piano', 'Dirt-Samples', 'EmuSP12', 'VCSL', 'mridangam'];

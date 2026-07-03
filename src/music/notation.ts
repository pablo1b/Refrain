// ---------------------------------------------------------------------------
// The Score lens — real notation, where it earns it (spec §12.1). Pitched voices
// engrave to a staff from the parsed tree; the moment a pattern exceeds what a
// staff can honestly show, the lens says so and defers to the code (the Tracker).
// It never lies with an approximation.
//
// This module is the pure math: pitch-token parsing, staff-position mapping, the
// engravability test, and the drag-a-notehead → new-note-literal rewrite. The
// SVG rendering + the live playhead live in the component (Lenses.tsx).
// ---------------------------------------------------------------------------

/** Diatonic step of each letter within an octave (c=0 … b=6) — for staff Y. */
const LETTER_STEP: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
/** Semitone of each natural letter — for MIDI. */
const LETTER_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const STEP_LETTER = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

export interface Pitch {
  letter: string; // 'c'..'b'
  accidental: '' | '#' | 'b';
  octave: number;
  midi: number;
  /** Absolute diatonic index = octave*7 + letterStep — the vertical staff axis. */
  diatonic: number;
}

export interface EngraveNote extends Pitch {
  tokenIndex: number; // index among the whitespace tokens of the note string (for editing)
  raw: string; // the original token, e.g. "eb2"
  x: number; // 0..1 rhythmic position across the cycle
}

export interface EngraveChord {
  x: number; // 0..1 position
  symbol: string; // "Cm7"
  rootDiatonic: number; // diatonic index of the root notehead (chord tones stack upward)
  size: number; // how many tertian noteheads to stack (triad=3, 7th=4…)
}

export type ScoreMode = 'melodic' | 'chords' | 'none';

export interface EngraveVoice {
  engravable: boolean;
  reason?: string; // why a voice is deferred (percussion / continuous / polyrhythm / microtonal)
  clef: 'treble' | 'bass';
  mode: ScoreMode;
  notes: EngraveNote[]; // editable melodic noteheads
  chords: EngraveChord[]; // read-only chord-symbol stack
}

/** Parse a single pitch token ("c2", "eb3", "f#4"). Returns null if not a pitch. */
export function parsePitch(tok: string): Pitch | null {
  const m = tok.match(/^([a-gA-G])(#|s|b|)(-?\d+)$/);
  if (!m) return null;
  const letter = m[1].toLowerCase();
  const accidental: Pitch['accidental'] = m[2] === '#' || m[2] === 's' ? '#' : m[2] === 'b' ? 'b' : '';
  const octave = parseInt(m[3], 10);
  const semi = LETTER_SEMI[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  return { letter, accidental, octave, midi: (octave + 1) * 12 + semi, diatonic: octave * 7 + LETTER_STEP[letter] };
}

/** Invert a diatonic index back to a natural letter + octave (for drag-edits). */
export function fromDiatonic(diatonic: number): { letter: string; octave: number } {
  const octave = Math.floor(diatonic / 7);
  const step = ((diatonic % 7) + 7) % 7;
  return { letter: STEP_LETTER[step], octave };
}

/** Pull the string argument of the first note()/chord() call, or null. */
function noteArg(expr: string): string | null {
  const m = expr.match(/\b(?:note|chord)\(\s*"([^"]*)"/);
  return m ? m[1] : null;
}

/** Split a mini-notation string into top-level tokens (ignores [] and <> groups). */
function topTokens(s: string): string[] {
  const out: string[] = [];
  let depthAngle = 0;
  let depthBracket = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<') depthAngle++;
    if (ch === '>') depthAngle = Math.max(0, depthAngle - 1);
    if (ch === '[') depthBracket++;
    if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    if (/\s/.test(ch) && depthAngle === 0 && depthBracket === 0) {
      if (cur) out.push(cur), (cur = '');
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const CHORD_RE = /^([A-G])(#|b)?(m|min|maj|dim|aug|sus2|sus4)?(6|7|9|11|13|maj7|m7|m9)?/;

/** Chord tone count from the quality suffix — how tall the tertian stack draws. */
function chordSize(symbol: string): number {
  if (/13/.test(symbol)) return 7;
  if (/11/.test(symbol)) return 6;
  if (/9/.test(symbol)) return 5;
  if (/7|6/.test(symbol)) return 4;
  return 3;
}

/**
 * Analyse a voice expression for the Score lens. Returns whether it engraves
 * honestly, its clef, and the note/chord geometry. Deferral reasons match the
 * spec: percussion, continuous signals, polyrhythm past 2-against-3, microtonal.
 */
export function analyzeVoiceForScore(expr: string): EngraveVoice {
  const defer = (reason: string): EngraveVoice => ({ engravable: false, reason, clef: 'treble', mode: 'none', notes: [], chords: [] });

  // must be a pitched, LITERAL note()/chord() voice — n()/scale degrees, freq()
  // and bare percussion route to the Tracker instead (honest, not a guess).
  const hasNote = /\b(?:note|chord)\(\s*"/.test(expr);
  if (!hasNote) {
    if (/\bn\(/.test(expr)) return defer('Scale-degree voice — shown on the Tracker, not engraved.');
    return defer('Percussion voice — shown on the Tracker, not engraved.');
  }
  // continuous signal fed to note() (e.g. note(sine.range(...))) can't engrave.
  // The lookahead skips whitespace too, so `note( "c3")` (space before the quote)
  // is NOT mistaken for a signal.
  if (/\b(?:note|chord)\(\s*(?!["\s])/.test(expr) || /\b(?:note|chord)\("[^"]*\b(?:sine|saw|isaw|tri|square|perlin|rand|range)\b/.test(expr)) {
    return defer('Continuous signal — stays code-only.');
  }
  const arg = noteArg(expr);
  if (arg == null) return defer('No engravable pitches — shown on the Tracker.');
  if (/\{/.test(arg)) return defer('Polyrhythm past 2-against-3 — stays code-only.');
  if (/\d+\.\d+/.test(arg)) return defer('Microtonal — stays code-only.');

  const tokens = topTokens(arg);

  // chord-symbol stream (read-only): angle-bracket alternation or capitalised roots
  const chordSyms = tokens.flatMap((tk) => (/^</.test(tk) ? topTokens(tk.replace(/[<>]/g, ' ')) : [tk])).filter((tk) => /^[A-G]/.test(tk) && CHORD_RE.test(tk));
  const pitchTokens = tokens.filter((tk) => parsePitch(tk));

  if (chordSyms.length && pitchTokens.length === 0) {
    const n = chordSyms.length;
    const chords: EngraveChord[] = chordSyms.map((symbol, i) => {
      const m = symbol.match(CHORD_RE)!;
      const rootLetter = m[1].toLowerCase();
      // roots sit in a comfortable reading octave; the SYMBOL carries the truth
      const rootDiatonic = 4 * 7 + LETTER_STEP[rootLetter];
      return { x: i / n, symbol, rootDiatonic, size: chordSize(symbol) };
    });
    return { engravable: true, clef: 'treble', mode: 'chords', notes: [], chords };
  }

  // melodic single-note line (editable)
  const notes: EngraveNote[] = [];
  tokens.forEach((tk, i) => {
    if (tk === '~' || tk === '-') return; // a rest occupies a step but draws nothing
    const p = parsePitch(tk);
    if (p) notes.push({ ...p, tokenIndex: i, raw: tk, x: i / Math.max(1, tokens.length) });
  });
  if (notes.length === 0) return defer('No engravable pitches — shown on the Tracker.');

  const avg = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
  return { engravable: true, clef: avg < 60 ? 'bass' : 'treble', mode: 'melodic', notes, chords: [] };
}

// ---- staff geometry (shared so the component and edit-inverse agree) ----
// Treble: bottom→top lines E4 G4 B4 D5 F5; top line F5. Bass: G2 B2 D3 F3 A3.
const TOP_DIATONIC = { treble: 5 * 7 + 3, bass: 3 * 7 + 5 }; // F5 · A3

/** Y of a diatonic index on a staff whose top line is at `topY`, lines `gap` apart. */
export function staffY(diatonic: number, clef: 'treble' | 'bass', topY: number, gap: number): number {
  return topY + (TOP_DIATONIC[clef] - diatonic) * (gap / 2);
}

/** Inverse of {@link staffY}: snap a Y back to the nearest diatonic index. */
export function diatonicAtY(y: number, clef: 'treble' | 'bass', topY: number, gap: number): number {
  return TOP_DIATONIC[clef] - Math.round((y - topY) / (gap / 2));
}

/**
 * Rewrite one token of a note string to a new diatonic pitch — the drag-a-
 * notehead edit (spec §12.1). Accidental is dropped to the natural of the new
 * letter (a staged, reversible diff the user can refine). Returns the new string.
 */
export function retuneNoteString(noteStr: string, tokenIndex: number, newDiatonic: number): string {
  const tokens = topTokens(noteStr);
  if (tokenIndex < 0 || tokenIndex >= tokens.length) return noteStr;
  const { letter, octave } = fromDiatonic(newDiatonic);
  tokens[tokenIndex] = `${letter}${octave}`;
  return tokens.join(' ');
}

// ---------------------------------------------------------------------------
// The Maestro's vocabulary. A *directive* is a curated musical verb with a
// bounded, reproducible transform — the Maestro picks targets & degree, the
// shape of the transform is known (spec §06). Everything here is deterministic
// and produces real, inspectable Strudel code.
// ---------------------------------------------------------------------------

import type { ParsedScore, ParsedVoice } from './parseScore';

export type DirectiveGroup = 'DYNAMICS' | 'AGOGICS' | 'ARTICULATION' | 'CHARACTER' | 'GESTURE';

export interface Directive {
  id: string;
  label: string; // italic musical term shown in palette
  group: DirectiveGroup;
  codeHint: string; // mono hint: "ramps .gain over n cycles"
  blurb: string; // plain-language gloss
  aliases: string[]; // natural-language triggers
}

// The four spec groups + a "gesture" group for the common plain-language verbs.
export const DIRECTIVES: Directive[] = [
  // DYNAMICS
  { id: 'crescendo', label: 'crescendo', group: 'DYNAMICS', codeHint: 'ramps .gain over n cycles', blurb: 'grow into the drop', aliases: ['crescendo', 'build up', 'swell', 'grow', 'ramp up'] },
  { id: 'diminuendo', label: 'diminuendo', group: 'DYNAMICS', codeHint: 'gain ↓ + opens space', blurb: 'pull back for a breakdown', aliases: ['diminuendo', 'fade out', 'fade down', 'ebb'] },
  { id: 'sforzando', label: 'sforzando', group: 'DYNAMICS', codeHint: 'accent one event hard', blurb: 'punch the downbeat', aliases: ['sforzando', 'accent', 'punch', 'hit hard'] },
  // AGOGICS
  { id: 'rubato', label: 'rubato', group: 'AGOGICS', codeHint: 'humanises timing (nudge)', blurb: 'loosen the grid', aliases: ['rubato', 'loosen', 'humanise', 'humanize', 'human feel'] },
  { id: 'accel', label: 'accel.', group: 'AGOGICS', codeHint: 'cps ramps up', blurb: 'a controlled gear-change', aliases: ['accelerando', 'accel', 'speed up tempo', 'push tempo'] },
  { id: 'rit', label: 'rit.', group: 'AGOGICS', codeHint: 'cps ramps down', blurb: 'ease off the tempo', aliases: ['ritardando', 'rit', 'slow tempo', 'pull tempo'] },
  { id: 'stretto', label: 'stretto', group: 'AGOGICS', codeHint: 'overlaps entries tighter', blurb: 'pile the canon up', aliases: ['stretto', 'overlap', 'canon'] },
  // ARTICULATION
  { id: 'staccato', label: 'staccato', group: 'ARTICULATION', codeHint: 'shortens .clip', blurb: 'make it bite', aliases: ['staccato', 'shorter', 'tighter notes', 'bite', 'choppy', 'clip'] },
  { id: 'legato', label: 'legato', group: 'ARTICULATION', codeHint: 'lengthens + glides', blurb: 'smooth the line', aliases: ['legato', 'smooth', 'connected', 'glide', 'flowing'] },
  { id: 'marcato', label: 'marcato', group: 'ARTICULATION', codeHint: 'per-event accent map', blurb: 'march it', aliases: ['marcato', 'march', 'marked', 'emphatic'] },
  // CHARACTER
  { id: 'cantabile', label: 'cantabile', group: 'CHARACTER', codeHint: 'smooth gain + voice-lead', blurb: 'make it sing', aliases: ['cantabile', 'sing', 'lyrical', 'singing'] },
  { id: 'confuoco', label: 'con fuoco', group: 'CHARACTER', codeHint: 'drive, dist, faster LFO', blurb: 'with fire', aliases: ['con fuoco', 'fuoco', 'fire', 'aggressive', 'drive', 'fierce'] },
  { id: 'misterioso', label: 'misterioso', group: 'CHARACTER', codeHint: 'reverb, lpf, sparse', blurb: 'make it haunt', aliases: ['misterioso', 'mysterious', 'haunt', 'eerie', 'spooky'] },
  // GESTURE — the common plain-language moves
  { id: 'swing', label: 'swing', group: 'GESTURE', codeHint: '.swingBy(1/3, n)', blurb: 'shuffle the grid', aliases: ['swing', 'shuffle', 'swung'] },
  { id: 'halftime', label: 'half-time', group: 'GESTURE', codeHint: '.slow(2)', blurb: 'half the tempo feel', aliases: ['half time', 'half-time', 'halftime', 'halve'] },
  { id: 'doubletime', label: 'double-time', group: 'GESTURE', codeHint: '.fast(2)', blurb: 'double the tempo feel', aliases: ['double time', 'double-time', 'doubletime'] },
  { id: 'octdown', label: 'octave down', group: 'GESTURE', codeHint: 'pitch −12', blurb: 'drop an octave', aliases: ['octave down', 'down an octave', 'lower octave', 'drop an octave', 'octave lower'] },
  { id: 'octup', label: 'octave up', group: 'GESTURE', codeHint: 'pitch +12', blurb: 'up an octave', aliases: ['octave up', 'up an octave', 'raise octave', 'octave higher'] },
  { id: 'darker', label: 'darker', group: 'GESTURE', codeHint: '.lpf(600)', blurb: 'close the filter', aliases: ['darker', 'muffled', 'muddier', 'warmer tone', 'duller'] },
  { id: 'brighter', label: 'brighter', group: 'GESTURE', codeHint: '.lpf(4500)', blurb: 'open the filter', aliases: ['brighter', 'open up', 'open the filter', 'crisper', 'sharper'] },
  { id: 'sparser', label: 'sparser', group: 'GESTURE', codeHint: '.degradeBy(0.4)', blurb: 'thin it out', aliases: ['sparser', 'thin out', 'fewer', 'less busy', 'strip back'] },
  { id: 'busier', label: 'busier', group: 'GESTURE', codeHint: '.ply(2)', blurb: 'more density', aliases: ['busier', 'denser', 'more notes', 'busy'] },
  { id: 'louder', label: 'louder', group: 'GESTURE', codeHint: '.gain(1.2)', blurb: 'bring it up', aliases: ['louder', 'bring up', 'turn up', 'boost'] },
  { id: 'quieter', label: 'quieter', group: 'GESTURE', codeHint: '.gain(0.6)', blurb: 'pull it down', aliases: ['quieter', 'turn down', 'bring down', 'softer'] },
  { id: 'reverb', label: 'reverberant', group: 'GESTURE', codeHint: '.room(0.6)', blurb: 'add space', aliases: ['reverb', 'wetter', 'more space', 'roomier', 'spacious'] },
  { id: 'pan', label: 'panned', group: 'GESTURE', codeHint: '.pan(sine.range…)', blurb: 'auto-pan it', aliases: ['pan', 'stereo', 'widen', 'autopan', 'auto-pan'] },
  { id: 'drop', label: 'drop', group: 'GESTURE', codeHint: '.gain(0)', blurb: 'silence the voice', aliases: ['drop', 'mute', 'kill', 'silence', 'cut'] },
];

export const DIRECTIVE_BY_ID = Object.fromEntries(DIRECTIVES.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
// Score-level helpers — operate on raw lines so unchanged lines stay byte-exact
// and the diff is minimal.
// ---------------------------------------------------------------------------

function appendChain(code: string, voice: ParsedVoice, method: string): string {
  const lines = code.split('\n');
  const newLine = voice.indent + method;
  lines.splice(voice.endLine + 1, 0, newLine);
  return lines.join('\n');
}

function editBlock(code: string, voice: ParsedVoice, fn: (text: string) => string): string {
  const lines = code.split('\n');
  const block = lines.slice(voice.startLine, voice.endLine + 1).join('\n');
  const next = fn(block);
  const before = lines.slice(0, voice.startLine);
  const after = lines.slice(voice.endLine + 1);
  return [...before, ...next.split('\n'), ...after].join('\n');
}

/** Shift every pitched token with an explicit octave digit by `delta`. */
function shiftOctave(block: string, delta: number): string {
  // Only touch contents inside note("…")/n("…") strings.
  return block.replace(/\b(note|n)\(\s*"([^"]*)"\s*\)/g, (_m, fn, body) => {
    // Only shift a pitch-letter+octave that stands alone — not a digit embedded
    // in a chord symbol (e.g. "Ab2maj7" must stay untouched).
    const shifted = body.replace(
      /(?<![A-Za-z0-9])([a-gA-G][#bs]?)(-?\d+)(?![0-9A-Za-z])/g,
      (_t: string, pc: string, oct: string) => pc + String(parseInt(oct, 10) + delta),
    );
    return `${fn}("${shifted}")`;
  });
}

export interface DirectiveResult {
  newScore: string;
  summary: string; // markdownish, voice + code references rendered by Maestro
}

/**
 * Apply a directive to a target voice within the score.
 * `degree` is an optional numeric argument (e.g. crescendo over N cycles).
 */
export function applyDirective(
  id: string,
  score: ParsedScore,
  fullCode: string,
  voice: ParsedVoice | undefined,
  degree?: number,
): DirectiveResult | { error: string } {
  const d = DIRECTIVE_BY_ID[id];
  if (!d) return { error: `Unknown directive “${id}”.` };

  // Global tempo directives don't need a voice.
  if (id === 'accel' || id === 'rit') {
    if (score.cps == null || score.cpsLine == null) {
      return { error: 'No `setcps(…)` line to ramp — add one first.' };
    }
    const dir = id === 'accel' ? 1 : -1;
    const step = dir * (degree ? degree / 100 : 0.06);
    const next = Math.max(0.1, +(score.cps + step).toFixed(3));
    const lines = fullCode.split('\n');
    lines[score.cpsLine] = lines[score.cpsLine].replace(
      /(set[Cc]ps\s*\(\s*)([\d.]+)(\s*\))/,
      `$1${next}$3`,
    );
    return {
      newScore: lines.join('\n'),
      summary: `${id === 'accel' ? 'Accelerando' : 'Ritardando'} — cps **${score.cps} → ${next}**. A controlled gear-change.`,
    };
  }

  if (!voice) return { error: 'No voice selected — click a voice in the outline, or name one.' };

  const where = `**${voice.sigil}**`;
  const code = (m: string) => `\`${m}\``;

  switch (id) {
    case 'crescendo': {
      const n = degree ?? 8;
      const m = `.gain(saw.range(0.35, 1).slow(${n}))`;
      return ok(appendChain(fullCode, voice, m), `Crescendo on ${where} — ${code(m)} ramps gain over ${n} cycles. Grow into the drop.`);
    }
    case 'diminuendo': {
      const n = degree ?? 8;
      const m = `.gain(saw.range(1, 0.2).slow(${n}))`;
      return ok(appendChain(fullCode, voice, m), `Diminuendo on ${where} — ${code(m)} pulls the gain back over ${n} cycles, opening space.`);
    }
    case 'sforzando': {
      const m = `.gain("1.6 0.8 0.8 0.8")`;
      return ok(appendChain(fullCode, voice, m), `Sforzando on ${where} — ${code(m)} accents the downbeat hard.`);
    }
    case 'rubato': {
      const m = `.late(rand.range(-0.012, 0.012))`;
      return ok(appendChain(fullCode, voice, m), `Rubato on ${where} — ${code(m)} humanises the timing, loosening the grid.`);
    }
    case 'stretto': {
      const m = `.superimpose(x => x.late(0.0625))`;
      return ok(appendChain(fullCode, voice, m), `Stretto on ${where} — ${code(m)} overlaps the entries tighter, piling the canon up.`);
    }
    case 'staccato': {
      const m = `.clip(0.4)`;
      return ok(appendChain(fullCode, voice, m), `Staccato on ${where} — ${code(m)} shortens each note so it bites.`);
    }
    case 'legato': {
      // legato() and clip() are the *same* core control (registered together as
      // c("clip", "legato")), so a leading .clip(1) would just be overwritten —
      // .legato(1.4) alone lengthens each note past its slot to connect the line.
      const m = `.legato(1.4)`;
      return ok(appendChain(fullCode, voice, m), `Legato on ${where} — ${code(m)} lengthens and connects the line.`);
    }
    case 'marcato': {
      const m = `.gain("1.3 0.9 1.1 0.9")`;
      return ok(appendChain(fullCode, voice, m), `Marcato on ${where} — ${code(m)} marks each event; it marches.`);
    }
    case 'cantabile': {
      const m = `.gain(perlin.range(0.6, 0.9)).clip(1.2)`;
      return ok(appendChain(fullCode, voice, m), `Cantabile on ${where} — ${code(m)} smooths the dynamics and lets it sing.`);
    }
    case 'confuoco': {
      const m = `.distort("1.6:0.4").gain(1.1)`;
      return ok(appendChain(fullCode, voice, m), `Con fuoco on ${where} — ${code(m)} adds drive and bite. With fire.`);
    }
    case 'misterioso': {
      const m = `.room(0.6).lpf(700).degradeBy(0.3)`;
      return ok(appendChain(fullCode, voice, m), `Misterioso on ${where} — ${code(m)}: reverberant, dark and sparse. Make it haunt.`);
    }
    case 'swing': {
      const n = degree ?? 8;
      const m = `.swingBy(1/3, ${n})`;
      return ok(appendChain(fullCode, voice, m), `Swing on ${where} — ${code(m)} shuffles the grid.`);
    }
    case 'halftime':
      return ok(appendChain(fullCode, voice, `.slow(2)`), `Half-time on ${where} — ${code('.slow(2)')} halves the feel.`);
    case 'doubletime':
      return ok(appendChain(fullCode, voice, `.fast(2)`), `Double-time on ${where} — ${code('.fast(2)')} doubles the feel.`);
    case 'octdown': {
      const next = shiftOctave(fullCode.split('\n').slice(voice.startLine, voice.endLine + 1).join('\n'), -1);
      if (next === fullCode.split('\n').slice(voice.startLine, voice.endLine + 1).join('\n')) {
        const m = `.add(note(-12))`;
        return ok(appendChain(fullCode, voice, m), `Down an octave on ${where} — ${code(m)} (no explicit octaves to rewrite).`);
      }
      return ok(editBlock(fullCode, voice, (b) => shiftOctave(b, -1)), `Down an octave on ${where} — rewrote the pitches −12.`);
    }
    case 'octup': {
      const blockText = fullCode.split('\n').slice(voice.startLine, voice.endLine + 1).join('\n');
      const next = shiftOctave(blockText, 1);
      if (next === blockText) {
        const m = `.add(note(12))`;
        return ok(appendChain(fullCode, voice, m), `Up an octave on ${where} — ${code(m)}.`);
      }
      return ok(editBlock(fullCode, voice, (b) => shiftOctave(b, 1)), `Up an octave on ${where} — rewrote the pitches +12.`);
    }
    case 'darker':
      return ok(appendChain(fullCode, voice, `.lpf(600)`), `Darker ${where} — ${code('.lpf(600)')} closes the filter.`);
    case 'brighter':
      return ok(appendChain(fullCode, voice, `.lpf(4500)`), `Brighter ${where} — ${code('.lpf(4500)')} opens the filter.`);
    case 'sparser':
      return ok(appendChain(fullCode, voice, `.degradeBy(0.4)`), `Sparser ${where} — ${code('.degradeBy(0.4)')} thins it out.`);
    case 'busier':
      return ok(appendChain(fullCode, voice, `.ply(2)`), `Busier ${where} — ${code('.ply(2)')} doubles the density.`);
    case 'louder':
      return ok(appendChain(fullCode, voice, `.gain(1.2)`), `Louder ${where} — ${code('.gain(1.2)')}.`);
    case 'quieter':
      return ok(appendChain(fullCode, voice, `.gain(0.6)`), `Quieter ${where} — ${code('.gain(0.6)')}.`);
    case 'reverb':
      return ok(appendChain(fullCode, voice, `.room(0.6)`), `Reverberant ${where} — ${code('.room(0.6)')} adds space.`);
    case 'pan':
      return ok(appendChain(fullCode, voice, `.pan(sine.range(0.2, 0.8).slow(4))`), `Panned ${where} — ${code('.pan(sine.range(0.2,0.8))')} drifts it across the field.`);
    case 'drop':
      return ok(appendChain(fullCode, voice, `.gain(0)`), `Dropped ${where} — ${code('.gain(0)')} silences it (one keystroke back).`);
    default:
      return { error: `Directive “${id}” is in the palette but not yet wired.` };
  }

  function ok(newScore: string, summary: string): DirectiveResult {
    return { newScore, summary };
  }
}

// ---------------------------------------------------------------------------
// Natural-language interpretation: free text → { directiveId, voiceHint, degree }
// or a generation/answer intent.
// ---------------------------------------------------------------------------

export type Intent =
  | { kind: 'directive'; id: string; voiceHint?: string; degree?: number }
  | { kind: 'lanes'; prompt: string }
  | { kind: 'answer'; question: string }
  | { kind: 'unknown'; text: string };

const GEN_RE = /\b(ways?|variations?|options?|ideas?|forks?|lanes?|give me|generate|come up with|suggest)\b/i;
const ASK_RE = /^(what|why|how|explain|does|do |tell me|describe|which)\b/i;

export function interpret(text: string, voiceIds: string[]): Intent {
  const raw = text.trim();
  const t = raw.toLowerCase();

  // slash command: /swing $hats 8
  if (raw.startsWith('/')) {
    const parts = raw.slice(1).trim().split(/\s+/);
    const id = resolveDirectiveId(parts[0]);
    if (id) {
      let voiceHint: string | undefined;
      let degree: number | undefined;
      for (const p of parts.slice(1)) {
        if (p.startsWith('$')) voiceHint = p.slice(1);
        else if (voiceIds.includes(p)) voiceHint = p;
        else if (/^\d+(\.\d+)?$/.test(p)) degree = parseFloat(p);
      }
      return { kind: 'directive', id, voiceHint, degree };
    }
    return { kind: 'unknown', text: raw };
  }

  // question
  if (ASK_RE.test(raw)) return { kind: 'answer', question: raw };

  // generation
  if (GEN_RE.test(raw) && !ASK_RE.test(raw)) return { kind: 'lanes', prompt: raw };

  // directive by alias keyword
  const voiceHint = voiceIds.find((v) => new RegExp(`\\b\\$?${v}\\b`).test(t));
  const degree = extractNumber(t);

  // longest-alias-first match so "down an octave" beats "down"
  const matches: { id: string; len: number }[] = [];
  for (const d of DIRECTIVES) {
    for (const a of d.aliases) {
      if (t.includes(a)) matches.push({ id: d.id, len: a.length });
    }
  }
  if (matches.length) {
    matches.sort((a, b) => b.len - a.len);
    return { kind: 'directive', id: matches[0].id, voiceHint, degree };
  }

  return { kind: 'unknown', text: raw };
}

function resolveDirectiveId(token: string): string | null {
  if (!token) return null;
  const tok = token.toLowerCase();
  if (DIRECTIVE_BY_ID[tok]) return tok;
  for (const d of DIRECTIVES) {
    if (d.id === tok || d.label.toLowerCase() === tok || d.aliases.includes(tok)) return d.id;
  }
  return null;
}

function extractNumber(t: string): number | undefined {
  const m = t.match(/\b(\d+)\b/);
  return m ? parseInt(m[1], 10) : undefined;
}

import { describe, it, expect } from 'vitest';
import { applyDirective, interpret, normalizeVoiceHint, suggestDirectives, shortCustomAliases, DIRECTIVES, DIRECTIVE_BY_ID } from './directives';
import type { CustomDirective } from '../types';
import { parseScore } from './parseScore';

// Pure-logic tier: no mocks, no DOM. directives.ts is wholly deterministic — each
// id appends/edits a *known* Strudel fragment, octave shifts must not corrupt
// chord symbols, accel/rit rewrite only the cps line, and interpret() routes free
// text to a bounded intent. Every expected value is derived from the source.

// A compact multi-voice score. parseScore (the real one) gives us the line
// bookkeeping every transform relies on.
const SCORE = [
  'setcps(0.5)', // line 0
  '', // line 1
  '$drums: s("bd*2 sd")', // line 2 (single line, no continuation)
  '', // line 3
  '$bass: note("c2 eb2 g2 c3")', // line 4
  '  .s("sawtooth")', // line 5 (continuation, 2-space indent)
  '', // line 6
  '$pad: note("<Cm7 Abmaj7>")', // line 7
  '  .room(0.4)', // line 8 (continuation, 2-space indent)
].join('\n');

function voice(code: string, id: string) {
  const score = parseScore(code);
  return { score, v: score.voices.find((x) => x.id === id)! };
}

describe('applyDirective — simple append family', () => {
  // Each of these appends exactly one chain line (its known Strudel) right after
  // the targeted voice's endLine, using the voice's indent. Default degree = 8
  // where the source uses `degree ?? 8`.
  it.each([
    ['darker', '.lpf(600)'],
    ['brighter', '.lpf(4500)'],
    ['staccato', '.clip(0.4)'],
    ['legato', '.legato(1.4)'],
    ['marcato', '.gain("1.3 0.9 1.1 0.9")'],
    ['cantabile', '.gain(perlin.range(0.6, 0.9)).clip(1.2)'],
    ['confuoco', '.distort("1.6:0.4").gain(1.1)'],
    ['misterioso', '.room(0.6).lpf(700).degradeBy(0.3)'],
    ['sforzando', '.gain("1.6 0.8 0.8 0.8")'],
    ['rubato', '.late(rand.range(-0.012, 0.012))'],
    ['stretto', '.superimpose(x => x.late(0.0625))'],
    ['halftime', '.slow(2)'],
    ['doubletime', '.fast(2)'],
    ['louder', '.gain(1.2)'],
    ['quieter', '.gain(0.6)'],
    ['reverb', '.room(0.6)'],
    ['pan', '.pan(sine.range(0.2, 0.8).slow(4))'],
    ['busier', '.ply(2)'],
    ['sparser', '.degradeBy(0.4)'],
    ['drop', '.gain(0)'],
    ['swing', '.swingBy(1/3, 8)'], // default n = 8
    ['crescendo', '.gain(saw.range(0.35, 1).slow(8))'], // default n = 8
    ['diminuendo', '.gain(saw.range(1, 0.2).slow(8))'], // default n = 8
  ])('%s appends %s after the voice with its indent', (id, method) => {
    // Target $bass (endLine 5, indent "  "). Appended line lands at index 6.
    const { score, v } = voice(SCORE, 'bass');
    const r = applyDirective(id, score, SCORE, v) as { newScore: string };
    const lines = r.newScore.split('\n');
    expect(lines[6]).toBe('  ' + method);
    // The original bass block lines stay byte-exact.
    expect(lines[4]).toBe('$bass: note("c2 eb2 g2 c3")');
    expect(lines[5]).toBe('  .s("sawtooth")');
    // Everything above the voice is untouched.
    expect(lines.slice(0, 4)).toEqual([
      'setcps(0.5)',
      '',
      '$drums: s("bd*2 sd")',
      '',
    ]);
    // Exactly one line was added.
    expect(lines.length).toBe(SCORE.split('\n').length + 1);
  });
});

describe('applyDirective — single-line voice uses the default 7-space indent', () => {
  it('appends to $drums with parseScore default indent (no continuation lines)', () => {
    const { score, v } = voice(SCORE, 'drums');
    const r = applyDirective('darker', score, SCORE, v) as { newScore: string };
    const lines = r.newScore.split('\n');
    // $drums is line 2, endLine 2 → new line at index 3 with default 7-space indent.
    expect(lines[3]).toBe('       .lpf(600)');
    expect(lines[2]).toBe('$drums: s("bd*2 sd")');
  });
});

describe('applyDirective — degree overrides for the ramp family', () => {
  it('swing honours a custom degree', () => {
    const { score, v } = voice(SCORE, 'bass');
    const r = applyDirective('swing', score, SCORE, v, 16) as { newScore: string };
    expect(r.newScore.split('\n')[6]).toBe('  .swingBy(1/3, 16)');
  });

  it('crescendo honours a custom degree', () => {
    const { score, v } = voice(SCORE, 'bass');
    const r = applyDirective('crescendo', score, SCORE, v, 4) as { newScore: string };
    expect(r.newScore.split('\n')[6]).toBe('  .gain(saw.range(0.35, 1).slow(4))');
  });

  it('diminuendo honours a custom degree', () => {
    const { score, v } = voice(SCORE, 'bass');
    const r = applyDirective('diminuendo', score, SCORE, v, 4) as { newScore: string };
    expect(r.newScore.split('\n')[6]).toBe('  .gain(saw.range(1, 0.2).slow(4))');
  });
});

describe('applyDirective — octdown/octup', () => {
  it('octdown rewrites explicit octave digits in a bass note string (−12 semitones / −1 octave)', () => {
    const { score, v } = voice(SCORE, 'bass');
    const r = applyDirective('octdown', score, SCORE, v) as { newScore: string };
    const lines = r.newScore.split('\n');
    expect(lines[4]).toBe('$bass: note("c1 eb1 g1 c2")');
    // No appended line — it edits in place.
    expect(lines.length).toBe(SCORE.split('\n').length);
    // Continuation line untouched.
    expect(lines[5]).toBe('  .s("sawtooth")');
  });

  it('octup rewrites explicit octave digits upward (+1 octave)', () => {
    const { score, v } = voice(SCORE, 'bass');
    const r = applyDirective('octup', score, SCORE, v) as { newScore: string };
    expect(r.newScore.split('\n')[4]).toBe('$bass: note("c3 eb3 g3 c4")');
  });

  it('octdown does NOT corrupt chord symbols — pad block stays byte-identical and falls back to .add', () => {
    const { score, v } = voice(SCORE, 'pad');
    const r = applyDirective('octdown', score, SCORE, v) as { newScore: string };
    const lines = r.newScore.split('\n');
    // The chord-symbol note line is unchanged (regression-critical).
    expect(lines[7]).toBe('$pad: note("<Cm7 Abmaj7>")');
    expect(lines[8]).toBe('  .room(0.4)');
    // No explicit octaves to rewrite → append the relative-pitch fallback.
    expect(lines[9]).toBe('  .add(note(-12))');
    expect(lines.length).toBe(SCORE.split('\n').length + 1);
  });

  // The real regression (directives.ts comment: "Ab2maj7 must stay untouched"):
  // a pitch+octave token (c2, g2) must shift, while a chord symbol whose digit is
  // immediately followed by a letter (Ab2maj7) is protected by the trailing-char
  // negative lookahead. The fixture deliberately mixes both in one string so the
  // regex must *discriminate* — not merely fall back because nothing matched.
  it('octdown shifts real octave tokens but leaves digit-bearing chord symbols intact', () => {
    const code = '$mix: note("c2 Ab2maj7 g2")';
    const { score, v } = voice(code, 'mix');
    const r = applyDirective('octdown', score, code, v) as { newScore: string };
    expect(r.newScore).toBe('$mix: note("c1 Ab2maj7 g1")');
  });

  it('octup shifts real octave tokens but leaves digit-bearing chord symbols intact', () => {
    const code = '$mix: note("c2 Ab2maj7 g2")';
    const { score, v } = voice(code, 'mix');
    const r = applyDirective('octup', score, code, v) as { newScore: string };
    expect(r.newScore).toBe('$mix: note("c3 Ab2maj7 g3")');
  });

  it('octup falls back to .add(note(12)) when there are no explicit octave digits', () => {
    const { score, v } = voice(SCORE, 'pad');
    const r = applyDirective('octup', score, SCORE, v) as { newScore: string };
    const lines = r.newScore.split('\n');
    expect(lines[7]).toBe('$pad: note("<Cm7 Abmaj7>")');
    expect(lines[9]).toBe('  .add(note(12))');
  });
});

describe('applyDirective — accel/rit (global tempo)', () => {
  it('accel ramps cps up by the default 0.06 and rewrites only the cps line', () => {
    const score = parseScore(SCORE);
    const r = applyDirective('accel', score, SCORE, undefined) as { newScore: string };
    const lines = r.newScore.split('\n');
    expect(lines[0]).toBe('setcps(0.56)'); // 0.5 + 0.06
    // Every other line untouched.
    expect(lines.slice(1)).toEqual(SCORE.split('\n').slice(1));
  });

  it('rit ramps cps down by the default 0.06', () => {
    const score = parseScore(SCORE);
    const r = applyDirective('rit', score, SCORE, undefined) as { newScore: string };
    expect(r.newScore.split('\n')[0]).toBe('setcps(0.44)'); // 0.5 - 0.06
  });

  it('accel uses degree/100 as the step when a degree is given', () => {
    const score = parseScore(SCORE);
    const r = applyDirective('accel', score, SCORE, undefined, 12) as { newScore: string };
    expect(r.newScore.split('\n')[0]).toBe('setcps(0.62)'); // 0.5 + 12/100
  });

  it('rit clamps cps at the 0.1 floor', () => {
    const code = 'setcps(0.12)\n$d: s("bd")';
    const score = parseScore(code);
    const r = applyDirective('rit', score, code, undefined) as { newScore: string };
    // 0.12 - 0.06 = 0.06 → clamped to 0.1
    expect(r.newScore.split('\n')[0]).toBe('setcps(0.1)');
  });

  it('errors when there is no setcps line to ramp', () => {
    const code = '$d: s("bd")';
    const score = parseScore(code);
    const r = applyDirective('accel', score, code, undefined);
    expect(r).toEqual({ error: 'No `setcps(…)` line to ramp — add one first.' });
  });
});

describe('applyDirective — error paths', () => {
  it('returns an error for an unknown directive id', () => {
    const score = parseScore(SCORE);
    const r = applyDirective('nope', score, SCORE, undefined);
    expect(r).toEqual({ error: 'Unknown directive “nope”.' });
  });

  it('returns an error when a voice-directive has no voice', () => {
    const score = parseScore(SCORE);
    const r = applyDirective('darker', score, SCORE, undefined);
    expect(r).toEqual({
      error: 'No voice selected — click a voice in the outline, or name one.',
    });
  });
});

describe('applyDirective — summary references the voice and code', () => {
  it('includes the voice sigil and the appended method in the summary', () => {
    const { score, v } = voice(SCORE, 'bass');
    const r = applyDirective('darker', score, SCORE, v) as { summary: string };
    expect(r.summary).toContain('**$bass**');
    expect(r.summary).toContain('`.lpf(600)`');
  });
});

describe('interpret — slash commands', () => {
  it('parses "/swing $hats 8" into a directive with voiceHint and degree', () => {
    expect(interpret('/swing $hats 8', ['drums', 'hats', 'bass', 'pad'])).toEqual({
      kind: 'directive',
      id: 'swing',
      voiceHint: 'hats',
      degree: 8,
    });
  });

  it('detects a bare voice id (no $) present in the voiceIds list', () => {
    expect(interpret('/darker bass', ['drums', 'bass'])).toEqual({
      kind: 'directive',
      id: 'darker',
      voiceHint: 'bass',
      degree: undefined,
    });
  });

  // RE-BASELINED for A-7: an unrecognised *slash* token is now distinguishable
  // from unparseable prose, so the store can say "no such command" instead of
  // handing the token to an LLM. Prose still yields plain `unknown`.
  it('returns unknown-command for an unrecognised slash command', () => {
    expect(interpret('/notathing $hats', ['hats'])).toEqual({
      kind: 'unknown-command',
      token: 'notathing',
      text: '/notathing $hats',
    });
  });

  it('still returns plain unknown for unparseable prose', () => {
    expect(interpret('mauve', ['hats'])).toEqual({ kind: 'unknown', text: 'mauve' });
  });

  it('returns unknown-command with an empty token for a bare slash', () => {
    expect(interpret('/', ['hats'])).toEqual({ kind: 'unknown-command', token: '', text: '/' });
  });
});

// ---------------------------------------------------------------------------
// A21 — slash hygiene. The safety property that passed the live audit must keep
// holding: a prototype member name must resolve to NOTHING and throw NOTHING.
// A-7 adds a third guarantee — it must also fire no LLM call, which is asserted
// at the store tier (store.test.ts).
// ---------------------------------------------------------------------------
describe('slash hygiene — prototype keys resolve to nothing (A21)', () => {
  const POISON = ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty'];

  it.each(POISON)('/%s does not throw', (tok) => {
    expect(() => interpret(`/${tok}`, ['hats'])).not.toThrow();
  });

  it.each(POISON)('/%s resolves to unknown-command, never a directive', (tok) => {
    const intent = interpret(`/${tok}`, ['hats']);
    expect(intent.kind).toBe('unknown-command');
    expect(intent).not.toHaveProperty('id');
  });

  it.each(POISON)('applyDirective("%s") returns an honest error, not a default transform', (tok) => {
    const parsed = parseScore(SCORE);
    expect(applyDirective(tok, parsed, SCORE, parsed.voices[0])).toEqual({
      error: `Unknown directive “${tok}”.`,
    });
  });

  it.each(POISON)('a poisoned token is not treated as a custom verb either (%s)', (tok) => {
    const custom: CustomDirective[] = [{ id: 'u_shimmer', label: 'Shimmer', aliases: [], chain: '.room(0.5)', blurb: '' }];
    expect(interpret(`/${tok}`, ['hats'], custom).kind).toBe('unknown-command');
  });
});

// ---------------------------------------------------------------------------
// A-5 — a forged verb is a deterministic chain, so it must resolve through
// interpret() exactly like a built-in and never reach a provider.
// ---------------------------------------------------------------------------
describe('interpret — custom directives (A-5)', () => {
  const shimmer: CustomDirective = {
    id: 'u_shimmer',
    label: 'Shimmer',
    aliases: ['glisten'],
    chain: '.room(0.5).lpf(1200)',
    blurb: 'air',
  };

  it('resolves a custom verb by its label', () => {
    expect(interpret('/shimmer $pad', ['pad'], [shimmer])).toEqual({
      kind: 'directive',
      id: 'u_shimmer',
      voiceHint: 'pad',
      degree: undefined,
    });
  });

  it('resolves a custom verb by its id', () => {
    expect(interpret('/u_shimmer $pad', ['pad'], [shimmer]).kind).toBe('directive');
  });

  it('resolves a custom verb by an alias', () => {
    expect(interpret('/glisten $pad', ['pad'], [shimmer])).toMatchObject({ kind: 'directive', id: 'u_shimmer' });
  });

  it('resolves a custom verb from free text', () => {
    expect(interpret('add some glisten to the pad', ['pad'], [shimmer])).toMatchObject({
      kind: 'directive',
      id: 'u_shimmer',
      voiceHint: 'pad',
    });
  });

  it('a custom verb never shadows a built-in of the same name', () => {
    const impostor: CustomDirective = { id: 'u_darker', label: 'darker', aliases: [], chain: '.gain(0)', blurb: '' };
    expect(interpret('/darker $bass', ['bass'], [impostor])).toMatchObject({ kind: 'directive', id: 'darker' });
  });

  it('is unchanged when no custom pack is passed (back-compat)', () => {
    expect(interpret('/shimmer $pad', ['pad'])).toMatchObject({ kind: 'unknown-command', token: 'shimmer' });
  });
});

// ---------------------------------------------------------------------------
// D18/D19 — "a forged verb never shadows the documented vocabulary" has to hold
// on BOTH resolution paths. The slash path always resolved built-ins first, but
// prose length-sorted one merged pool, so a longer forged alias won. That
// falsified a guarantee already written into the commit message.
// ---------------------------------------------------------------------------
const shimmerVerb: CustomDirective = {
  id: 'u_shimmer',
  label: 'Shimmer',
  aliases: ['glisten'],
  chain: '.room(0.5).lpf(1200)',
  blurb: 'air',
};

describe('interpret — built-ins win on the prose path too (D18)', () => {
  /** A forged verb whose alias is LONGER than the built-in it collides with. */
  const impostor: CustomDirective = {
    id: 'u_mine',
    label: 'mine',
    aliases: ['make it darker'],
    chain: '.gain(0)',
    blurb: '',
  };

  it('a longer forged alias still loses to the built-in it collides with', () => {
    // "make it darker" (14) vs built-in `darker` (6) — length-sorting a single
    // merged pool used to hand this to the custom verb.
    expect(interpret('make it darker', ['bass'], [impostor])).toMatchObject({
      kind: 'directive',
      id: 'darker',
    });
  });

  it('a forged verb still resolves from prose when no built-in matches', () => {
    expect(interpret('add some glisten to the pad', ['pad'], [shimmerVerb])).toMatchObject({
      kind: 'directive',
      id: 'u_shimmer',
    });
  });

  it('longest-alias-first still holds WITHIN the built-in vocabulary', () => {
    // the pre-existing specificity rule must survive the precedence change
    expect(interpret('take it down an octave', ['bass']).kind).toBe('directive');
    expect(interpret('down an octave', ['bass'])).toMatchObject({ kind: 'directive', id: 'octdown' });
  });

  it('longest-alias-first still holds WITHIN the user pack', () => {
    const short: CustomDirective = { id: 'u_air', label: 'air', aliases: [], chain: '.room(0.2)', blurb: '' };
    const long: CustomDirective = { id: 'u_bigair', label: 'big air please', aliases: [], chain: '.room(0.9)', blurb: '' };
    expect(interpret('give it big air please', ['pad'], [short, long])).toMatchObject({ id: 'u_bigair' });
  });
});

describe('interpret — user aliases need a word boundary and 3 chars (D19)', () => {
  it('a user alias does not match inside a longer word', () => {
    const onVerb: CustomDirective = { id: 'u_on', label: 'onx', aliases: ['onx'], chain: '.gain(1)', blurb: '' };
    // "onx" must not fire on "saxonxylophone"
    expect(interpret('a saxonxylophone sound', ['pad'], [onVerb]).kind).toBe('unknown');
    expect(interpret('turn onx the pad', ['pad'], [onVerb])).toMatchObject({ kind: 'directive', id: 'u_on' });
  });

  it('an alias under 3 characters is ignored in prose', () => {
    const tiny: CustomDirective = { id: 'u_t', label: 'go', aliases: ['on'], chain: '.gain(0)', blurb: '' };
    // "on" would otherwise capture nearly every free-text turn reaching the
    // alias branch — including via substring, as in "phone"
    expect(interpret('put it on the phone', ['pad'], [tiny]).kind).toBe('unknown');
    expect(interpret('go now', ['pad'], [tiny]).kind).toBe('unknown');
  });

  it('a short alias is still invocable explicitly as a slash verb', () => {
    // the floor is a prose-discovery guard, not a ban on the verb
    const tiny: CustomDirective = { id: 'u_t', label: 'go', aliases: ['on'], chain: '.gain(0)', blurb: '' };
    expect(interpret('/go $pad', ['pad'], [tiny])).toMatchObject({ kind: 'directive', id: 'u_t' });
    expect(interpret('/on $pad', ['pad'], [tiny])).toMatchObject({ kind: 'directive', id: 'u_t' });
  });

  it('shortCustomAliases reports exactly what will not match prose', () => {
    expect(shortCustomAliases({ id: 'u_t', label: 'go', aliases: ['on', 'glisten'], chain: '', blurb: '' })).toEqual(['go', 'on']);
    expect(shortCustomAliases({ id: 'u_s', label: 'Shimmer', aliases: [], chain: '', blurb: '' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A-10 — voice ids never carry the sigil, so a hint must be normalised or the
// directive silently mis-targets another voice.
// ---------------------------------------------------------------------------
describe('normalizeVoiceHint (A-10)', () => {
  it.each([
    ['$drums', 'drums'],
    ['$$drums', 'drums'],
    ['  drums ', 'drums'],
    ['  $drums  ', 'drums'],
    ['drums', 'drums'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeVoiceHint(input)).toBe(expected);
  });

  it.each([undefined, '', '   ', '$', '$$'])('treats %s as no hint', (input) => {
    expect(normalizeVoiceHint(input as string | undefined)).toBeUndefined();
  });

  it('strips the sigil when interpreting a slash directive', () => {
    expect(interpret('/darker $bass', ['bass'])).toMatchObject({ voiceHint: 'bass' });
  });

  it('accepts a bare voice id in the wrong case', () => {
    expect(interpret('/darker Bass', ['bass'])).toMatchObject({ kind: 'directive', voiceHint: 'Bass' });
  });
});

// ---------------------------------------------------------------------------
// A-7 — suggestions are a deterministic lookup over the real vocabulary.
// ---------------------------------------------------------------------------
describe('suggestDirectives (A-7)', () => {
  it('suggests a real verb for a near-miss prefix', () => {
    expect(suggestDirectives('dark')).toContain('darker');
  });

  it('returns nothing for a token that resembles no verb', () => {
    expect(suggestDirectives('zzzqqq')).toEqual([]);
  });

  it('returns nothing for an empty token', () => {
    expect(suggestDirectives('')).toEqual([]);
  });

  it('includes a custom verb when one is passed', () => {
    const custom: CustomDirective[] = [{ id: 'u_shimmer', label: 'Shimmer', aliases: [], chain: '.room(0.5)', blurb: '' }];
    expect(suggestDirectives('shim', custom)).toContain('Shimmer');
  });

  it('honours the limit and never repeats a label', () => {
    const out = suggestDirectives('a', [], 3);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(new Set(out).size).toBe(out.length);
  });

  it('suggests a slash command too', () => {
    expect(suggestDirectives('vari')).toContain('/variations');
  });
});

describe('interpret — questions vs generation vs directives', () => {
  it.each([
    'what does swing do',
    'why is it quiet',
    'how do I add reverb',
    'explain the bass',
    'describe this pattern',
    'which voice is loudest',
  ])('routes "%s" to an answer', (q) => {
    const r = interpret(q, ['bass']);
    expect(r).toEqual({ kind: 'answer', question: q });
  });

  it.each([
    'give me some variations',
    'ways to vary the bass',
    'generate options',
    'come up with ideas',
    'suggest some forks',
  ])('routes "%s" to lanes generation', (p) => {
    const r = interpret(p, ['bass']);
    expect(r).toEqual({ kind: 'lanes', prompt: p });
  });

  it('plain unmatched text is unknown', () => {
    expect(interpret('the weather is nice today', ['bass'])).toEqual({
      kind: 'unknown',
      text: 'the weather is nice today',
    });
  });
});

describe('interpret — alias matching is longest-first', () => {
  it('"drop it down an octave" resolves octdown, not drop', () => {
    // "drop" (len 4) and "down an octave" (len 14) both match — longest wins.
    const r = interpret('drop it down an octave', ['bass']);
    expect(r).toMatchObject({ kind: 'directive', id: 'octdown' });
  });

  it('a bare "drop" still resolves to drop', () => {
    const r = interpret('drop the bass', ['bass']);
    expect(r).toMatchObject({ kind: 'directive', id: 'drop' });
  });
});

describe('interpret — voiceHint and degree extraction from free text', () => {
  it('detects a voiceHint from a voice id present in the text', () => {
    const r = interpret('make the hats darker', ['drums', 'hats', 'bass']);
    expect(r).toMatchObject({ kind: 'directive', id: 'darker', voiceHint: 'hats' });
  });

  it('extracts a degree number from the text', () => {
    const r = interpret('swing the bass by 12', ['bass']);
    expect(r).toMatchObject({ kind: 'directive', id: 'swing', voiceHint: 'bass', degree: 12 });
  });

  it('leaves voiceHint undefined when no voice id appears', () => {
    const r = interpret('make it darker', ['drums', 'hats']) as {
      kind: string;
      voiceHint?: string;
    };
    expect(r.kind).toBe('directive');
    expect(r.voiceHint).toBeUndefined();
  });
});

describe('DIRECTIVES table integrity', () => {
  it('DIRECTIVE_BY_ID indexes every directive by id', () => {
    for (const d of DIRECTIVES) {
      expect(DIRECTIVE_BY_ID[d.id]).toBe(d);
    }
  });
});

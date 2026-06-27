import { describe, it, expect } from 'vitest';
import { parseScore, estimateEvents, replaceBlock, voiceExprForEval } from './parseScore';
import { DEFAULT_SCORE } from '../state/store';

// Pure-logic tier: no mocks, no DOM. parseScore is the foundation every other
// layer reads, so its line bookkeeping must be exact.

describe('parseScore', () => {
  it('parses the default score into four named voices', () => {
    const { voices } = parseScore(DEFAULT_SCORE);
    expect(voices.map((v) => v.id)).toEqual(['drums', 'hats', 'bass', 'pad']);
    expect(voices.map((v) => v.sigil)).toEqual(['$drums', '$hats', '$bass', '$pad']);
  });

  it('records exact start/end lines including indented continuations', () => {
    const { voices } = parseScore(DEFAULT_SCORE);
    const by = Object.fromEntries(voices.map((v) => [v.id, v]));
    expect([by.drums.startLine, by.drums.endLine]).toEqual([3, 3]);
    expect([by.hats.startLine, by.hats.endLine]).toEqual([4, 5]); // + .pan continuation
    expect([by.bass.startLine, by.bass.endLine]).toEqual([6, 8]); // + .s + .lpf
    expect([by.pad.startLine, by.pad.endLine]).toEqual([10, 12]);
  });

  it('detects the setcps line and value', () => {
    const { cps, cpsLine } = parseScore(DEFAULT_SCORE);
    expect(cps).toBe(0.5);
    expect(cpsLine).toBe(1);
  });

  it('joins continuation lines into the voice expression', () => {
    const { voices } = parseScore(DEFAULT_SCORE);
    const bass = voices.find((v) => v.id === 'bass')!;
    expect(bass.expr).toContain('note("c2 eb2 g2 c3")');
    expect(bass.expr).toContain('.s("sawtooth")');
    expect(bass.expr).toContain('.lpf(');
  });

  it('returns no voices for an empty or comment-only score', () => {
    expect(parseScore('').voices).toEqual([]);
    expect(parseScore('// just a comment\nsetcps(1)').voices).toEqual([]);
  });

  it('treats a blank line as the end of a voice block', () => {
    const code = '$a: s("bd")\n\n$b: s("sd")';
    const { voices } = parseScore(code);
    expect(voices).toHaveLength(2);
    expect(voices[0].endLine).toBe(0);
  });

  // The id charclass is [A-Za-z_][\w-]*, so hyphens and underscores are legal
  // mid-id characters and must survive into both id and the reconstructed sigil.
  it.each([
    ['$my-voice', 'my-voice', '$my-voice'],
    ['$my_voice', 'my_voice', '$my_voice'],
  ])('parses %s with hyphen/underscore id', (src, id, sigil) => {
    const { voices } = parseScore(`${src}: s("bd")`);
    expect(voices).toHaveLength(1);
    expect(voices[0].id).toBe(id);
    expect(voices[0].sigil).toBe(sigil);
  });

  // A continuation block only absorbs *indented* lines; a non-indented top-level
  // statement (here a setcps call) ends the block at the prior line.
  it('ends a continuation block at a non-indented top-level statement', () => {
    const code = '$a: s("bd")\n  .gain(0.8)\nsetcps(1)\n$b: s("sd")';
    const { voices } = parseScore(code);
    const a = voices.find((v) => v.id === 'a')!;
    expect([a.startLine, a.endLine]).toEqual([0, 1]); // includes .gain, stops before setcps
    expect(a.expr).toContain('.gain(0.8)');
    expect(voices.map((v) => v.id)).toEqual(['a', 'b']);
  });

  // The cps capture is guarded by `cps === null`, so only the FIRST setcps wins.
  it('records only the first setcps when several are present', () => {
    const code = 'setcps(0.25)\nsetcps(0.75)\n$a: s("bd")';
    const { cps, cpsLine } = parseScore(code);
    expect(cps).toBe(0.25);
    expect(cpsLine).toBe(0);
  });

  // The regex is set[Cc]ps, so the camelCase setCps form is also detected.
  it('matches the capital-C setCps spelling', () => {
    const { cps, cpsLine } = parseScore('setCps(0.4)\n$a: s("bd")');
    expect(cps).toBe(0.4);
    expect(cpsLine).toBe(0);
  });

  // VOICE_RE opens with ^(\s*), so a leading-indented $voice line still parses.
  it('parses a $voice line that has leading indentation', () => {
    const { voices } = parseScore('  $solo: s("cp")');
    expect(voices).toHaveLength(1);
    expect(voices[0].id).toBe('solo');
    expect(voices[0].sigil).toBe('$solo');
    expect(voices[0].startLine).toBe(0);
  });
});

describe('estimateEvents', () => {
  it.each([
    ['s("hh*8")', 8],
    ['s("bd*2, ~ sd")', 2], // comma stack → max branch
    ['note("c2 eb2 g2 c3")', 4],
    ['note("<Cm7 Abmaj7>")', 1], // angle alternation cycles ~1/cycle
    ['s("bd")', 1],
    ['no string here', 1],
    ['s("[bd sd] hh")', 3], // brackets stripped: bd sd hh
    ['s("a, b c, d e f")', 3], // comma stack → max branch (3-token branch)
    ['s("<a b c>")', 1], // angle alternation collapses to one symbol
  ])('estimates %s as %i events', (expr, expected) => {
    expect(estimateEvents(expr)).toBe(expected);
  });

  it('clamps to the [1, 64] range', () => {
    expect(estimateEvents('s("bd*999")')).toBe(64);
    expect(estimateEvents('s("~")')).toBe(1);
  });
});

describe('voiceExprForEval', () => {
  it('returns the voice expression unchanged', () => {
    const { voices } = parseScore('$a: note("c2 eb2")\n  .lpf(400)');
    const expr = voiceExprForEval(voices[0]);
    expect(expr).toBe(voices[0].expr);
    expect(expr).toContain('note("c2 eb2")');
    expect(expr).toContain('.lpf(400)');
  });
});

describe('replaceBlock', () => {
  it('swaps an inclusive line range for new text', () => {
    const code = 'a\nb\nc\nd';
    expect(replaceBlock(code, 1, 2, 'X\nY')).toBe('a\nX\nY\nd');
  });

  it('can replace a single line', () => {
    expect(replaceBlock('a\nb\nc', 1, 1, 'B')).toBe('a\nB\nc');
  });
});

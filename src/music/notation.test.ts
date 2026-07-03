import { describe, it, expect } from 'vitest';
import {
  parsePitch,
  fromDiatonic,
  analyzeVoiceForScore,
  retuneNoteString,
  staffY,
  diatonicAtY,
} from './notation';

// The Score lens math (spec §12.1): pitched voices engrave; everything a staff
// can't honestly show defers to the Tracker. Drag → new note literal.

describe('parsePitch', () => {
  it('parses letter + octave to the right MIDI + diatonic', () => {
    expect(parsePitch('c4')).toMatchObject({ letter: 'c', octave: 4, accidental: '', midi: 60 });
    expect(parsePitch('a4')!.midi).toBe(69);
  });
  it('handles sharps (# and s) and flats', () => {
    expect(parsePitch('f#4')!.midi).toBe(66);
    expect(parsePitch('fs4')!.midi).toBe(66);
    expect(parsePitch('eb2')!.midi).toBe(39);
  });
  it('rejects non-pitch tokens', () => {
    expect(parsePitch('~')).toBeNull();
    expect(parsePitch('bd')).toBeNull();
    expect(parsePitch('Cm7')).toBeNull();
  });
});

describe('fromDiatonic round-trips parsePitch', () => {
  it('inverts a parsed pitch back to its letter + octave', () => {
    const p = parsePitch('g2')!;
    expect(fromDiatonic(p.diatonic)).toEqual({ letter: 'g', octave: 2 });
  });
});

describe('analyzeVoiceForScore — engravable', () => {
  it('engraves a melodic note() line and picks the clef by register', () => {
    const bass = analyzeVoiceForScore('note("c2 eb2 g2 c3").s("sawtooth")');
    expect(bass.engravable).toBe(true);
    expect(bass.mode).toBe('melodic');
    expect(bass.clef).toBe('bass');
    expect(bass.notes.map((n) => n.raw)).toEqual(['c2', 'eb2', 'g2', 'c3']);
    expect(bass.notes[0].x).toBeCloseTo(0, 5);
  });

  it('reads a chord-symbol stream as read-only chords', () => {
    const pad = analyzeVoiceForScore('note("<Cm7 Abmaj7>").s("sawtooth")');
    expect(pad.engravable).toBe(true);
    expect(pad.mode).toBe('chords');
    expect(pad.chords.map((c) => c.symbol)).toEqual(['Cm7', 'Abmaj7']);
    expect(pad.chords[0].size).toBe(4); // a 7th chord stacks four noteheads
  });

  it('skips rests but keeps their rhythmic step', () => {
    const v = analyzeVoiceForScore('note("c3 ~ e3 ~")');
    expect(v.notes.map((n) => n.raw)).toEqual(['c3', 'e3']);
    expect(v.notes[1].x).toBeCloseTo(0.5, 5); // e3 is the 3rd of 4 steps
  });
});

describe('analyzeVoiceForScore — deferrals (never lie with an approximation)', () => {
  it('defers percussion to the Tracker', () => {
    const v = analyzeVoiceForScore('s("bd*2, ~ sd").bank("RolandTR909")');
    expect(v.engravable).toBe(false);
    expect(v.reason).toMatch(/percussion/i);
  });
  it('defers scale-degree n() voices', () => {
    const v = analyzeVoiceForScore('n("0 2 4").scale("C:minor")');
    expect(v.engravable).toBe(false);
    expect(v.reason).toMatch(/scale/i);
  });
  it('defers continuous signals fed to note()', () => {
    expect(analyzeVoiceForScore('note(sine.range(48,60))').engravable).toBe(false);
    expect(analyzeVoiceForScore('note("c2").lpf(sine.range(300,1200))').engravable).toBe(true); // signal on a filter is fine
  });
  it('does not mistake whitespace before the quote for a signal', () => {
    expect(analyzeVoiceForScore('note( "c3 e3")').engravable).toBe(true);
  });
  it('defers polyrhythm past 2-against-3 and microtonality', () => {
    expect(analyzeVoiceForScore('note("{c2 e2 g2}%3")').reason).toMatch(/polyrhythm/i);
    expect(analyzeVoiceForScore('note("60.5 62.5")').reason).toMatch(/microtonal/i);
  });
});

describe('staff geometry round-trip', () => {
  it('diatonicAtY inverts staffY', () => {
    const p = parsePitch('b4')!; // sits on the middle treble line
    const y = staffY(p.diatonic, 'treble', 0, 10);
    expect(diatonicAtY(y, 'treble', 0, 10)).toBe(p.diatonic);
  });
});

describe('retuneNoteString — drag a notehead', () => {
  it('rewrites just the dragged token to the new pitch', () => {
    const p = parsePitch('e3')!;
    const out = retuneNoteString('c2 eb2 g2 c3', 1, p.diatonic);
    expect(out).toBe('c2 e3 g2 c3');
  });
  it('leaves the string untouched for an out-of-range index', () => {
    expect(retuneNoteString('c2 eb2', 9, 30)).toBe('c2 eb2');
  });
});

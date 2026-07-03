import { describe, it, expect } from 'vitest';
import { mergeScores, applyResolutions, voiceBlocks } from './merge';

// Voice-granular merge (spec §12.6): disjoint voices union automatically; only
// same-voice edits conflict; global setcps is last-writer-wins.

const BASE = `setcps(0.5)

$drums: s("bd*2")
$bass: note("c2 eb2")
$pad: note("<Cm7 Abmaj7>")`;

describe('voiceBlocks', () => {
  it('maps each voice to its block text and span', () => {
    const m = voiceBlocks(BASE);
    expect([...m.keys()]).toEqual(['drums', 'bass', 'pad']);
    expect(m.get('bass')!.block).toBe('$bass: note("c2 eb2")');
  });
});

describe('mergeScores — disjoint voices', () => {
  it('unions edits to different voices automatically, no conflicts', () => {
    const ours = BASE.replace('s("bd*2")', 's("bd*4")'); // edit $drums
    const theirs = BASE.replace('note("c2 eb2")', 'note("c2 eb2 g2")'); // edit $bass
    const r = mergeScores(BASE, ours, theirs);
    expect(r.conflicts).toHaveLength(0);
    expect(r.clean).toEqual(['bass']);
    expect(r.merged).toContain('s("bd*4")'); // ours kept
    expect(r.merged).toContain('note("c2 eb2 g2")'); // theirs applied
  });

  it('applies a voice ADDED on the branch', () => {
    const theirs = BASE + '\n\n$hats: s("hh*8")';
    const r = mergeScores(BASE, BASE, theirs);
    expect(r.conflicts).toHaveLength(0);
    expect(r.clean).toContain('hats');
    expect(r.merged).toContain('$hats: s("hh*8")');
  });

  it('applies a voice DELETED on the branch', () => {
    const theirs = BASE.split('\n').filter((l) => !l.startsWith('$pad')).join('\n');
    const r = mergeScores(BASE, BASE, theirs);
    expect(r.clean).toContain('pad');
    expect(r.merged).not.toContain('$pad');
  });
});

describe('mergeScores — same-voice conflict', () => {
  it('flags a conflict when both sides edit the same voice differently', () => {
    const ours = BASE.replace('s("bd*2")', 's("bd*4")');
    const theirs = BASE.replace('s("bd*2")', 's("bd*2, ~ sd")');
    const r = mergeScores(BASE, ours, theirs);
    expect(r.conflicts.map((c) => c.voiceId)).toEqual(['drums']);
    expect(r.merged).toContain('s("bd*4")'); // ours stands until resolved
    const c = r.conflicts[0];
    expect(c.ours).toContain('bd*4');
    expect(c.theirs).toContain('~ sd');
  });

  it('is not a conflict when both sides made the identical edit', () => {
    const edit = BASE.replace('s("bd*2")', 's("bd*4")');
    const r = mergeScores(BASE, edit, edit);
    expect(r.conflicts).toHaveLength(0);
  });

  it('applyResolutions("theirs") swaps in the branch version', () => {
    const ours = BASE.replace('s("bd*2")', 's("bd*4")');
    const theirs = BASE.replace('s("bd*2")', 's("bd*2, ~ sd")');
    const r = mergeScores(BASE, ours, theirs);
    const resolved = applyResolutions(r, { drums: 'theirs' });
    expect(resolved).toContain('s("bd*2, ~ sd")');
    expect(resolved).not.toContain('s("bd*4")');
  });

  it('applyResolutions("mine"/"lanes"/"audition") keeps ours as committed text', () => {
    const ours = BASE.replace('s("bd*2")', 's("bd*4")');
    const theirs = BASE.replace('s("bd*2")', 's("bd*2, ~ sd")');
    const r = mergeScores(BASE, ours, theirs);
    for (const choice of ['mine', 'lanes', 'audition'] as const) {
      expect(applyResolutions(r, { drums: choice })).toContain('s("bd*4")');
    }
  });
});

describe('applyResolutions — delete/modify conflicts (spec §12.6)', () => {
  it('"keep theirs" re-adds a voice that ours deleted but theirs modified', () => {
    const ours = BASE.split('\n').filter((l) => !l.startsWith('$pad')).join('\n');
    const theirs = BASE.replace('<Cm7 Abmaj7>', '<Cm7 Fm9>');
    const r = mergeScores(BASE, ours, theirs);
    expect(r.conflicts.map((c) => c.voiceId)).toContain('pad');
    const resolved = applyResolutions(r, { pad: 'theirs' });
    expect(resolved).toContain('<Cm7 Fm9>');
  });

  it('"keep theirs" honours a deletion when theirs removed the voice', () => {
    const ours = BASE.replace('note("c2 eb2")', 'note("c2 c2")');
    const theirs = BASE.split('\n').filter((l) => !l.startsWith('$bass')).join('\n');
    const r = mergeScores(BASE, ours, theirs);
    expect(r.conflicts.map((c) => c.voiceId)).toContain('bass');
    const resolved = applyResolutions(r, { bass: 'theirs' });
    expect(resolved).not.toContain('$bass');
  });
});

describe('mergeScores — global setcps LWW', () => {
  it('inserts a setcps line when only theirs adds the tempo and merged has none', () => {
    const base = '$a: s("bd")';
    const ours = '$a: s("bd*2")';
    const theirs = 'setcps(0.75)\n$a: s("bd")';
    const r = mergeScores(base, ours, theirs);
    expect(r.cpsWinner).toBe('theirs');
    expect(r.merged).toContain('setcps(0.75)');
  });

  it('takes theirs when only theirs changed the tempo', () => {
    const theirs = BASE.replace('setcps(0.5)', 'setcps(0.75)');
    const r = mergeScores(BASE, BASE, theirs);
    expect(r.cpsWinner).toBe('theirs');
    expect(r.merged).toContain('setcps(0.75)');
  });

  it('HEAD wins a two-sided tempo change, loser noted', () => {
    const ours = BASE.replace('setcps(0.5)', 'setcps(0.6)');
    const theirs = BASE.replace('setcps(0.5)', 'setcps(0.9)');
    const r = mergeScores(BASE, ours, theirs);
    expect(r.cpsWinner).toBe('ours');
    expect(r.merged).toContain('setcps(0.6)');
  });
});

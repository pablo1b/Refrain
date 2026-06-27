import { describe, it, expect } from 'vitest';
import { computeHunks, applyEnabled, countHunks } from './diff';

// Pure-logic tier: no mocks, no DOM. diff is an LCS line differ that splits a
// staged edit into individually-toggleable hunks. Every expected value below is
// traced through the LCS backtrack in diff.ts — the transform is deterministic.

describe('computeHunks', () => {
  it('builds a single change hunk for one added line, with ctx each side', () => {
    // old=[a,b,c] new=[a,X,b,c]: X is added between the equal runs [a] and [b,c].
    const hunks = computeHunks('a\nb\nc', 'a\nX\nb\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].rows).toEqual([
      { op: 'ctx', text: 'a' },
      { op: 'add', text: 'X' },
      { op: 'ctx', text: 'b' },
    ]);
    expect(hunks[0].newStart).toBe(1);
  });

  it('builds a single change hunk for one deleted line, with ctx each side', () => {
    // old=[a,b,c] new=[a,c]: b is deleted; surrounding ctx is a (before) and c (after).
    const hunks = computeHunks('a\nb\nc', 'a\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].rows).toEqual([
      { op: 'ctx', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'ctx', text: 'c' },
    ]);
    expect(hunks[0].newStart).toBe(1);
  });

  it('builds a del+add hunk for one changed line, ctx then del then add then ctx', () => {
    // a changed line is a del of the old text followed by an add of the new text.
    const hunks = computeHunks('a\nb\nc', 'a\nB\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].rows).toEqual([
      { op: 'ctx', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'B' },
      { op: 'ctx', text: 'c' },
    ]);
  });

  it('emits the del rows before the add rows within a change hunk', () => {
    const rows = computeHunks('a\nb\nc', 'a\nB\nc')[0].rows;
    const delIdx = rows.findIndex((r) => r.op === 'del');
    const addIdx = rows.findIndex((r) => r.op === 'add');
    expect(delIdx).toBeLessThan(addIdx);
  });

  it('splits two separate change regions into two hunks with correct newStart', () => {
    // old=[a,b,c,d,e] new=[a,B,c,D,e]: changes at line 2 and line 4, separated by
    // the unchanged line c. Each change becomes its own hunk.
    const hunks = computeHunks('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne');
    expect(hunks).toHaveLength(2);
    expect(hunks.map((h) => h.id)).toEqual(['h0', 'h1']);
    expect(hunks[0].rows).toEqual([
      { op: 'ctx', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'B' },
      { op: 'ctx', text: 'c' },
    ]);
    expect(hunks[1].rows).toEqual([
      { op: 'ctx', text: 'c' },
      { op: 'del', text: 'd' },
      { op: 'add', text: 'D' },
      { op: 'ctx', text: 'e' },
    ]);
    // newStart counts new-file lines: first hunk at line 1 (incl. leading ctx),
    // second hunk begins at the ctx line c which is new-file line 3.
    expect(hunks.map((h) => h.newStart)).toEqual([1, 3]);
  });
});

describe('applyEnabled round-trips', () => {
  const oldCode = 'a\nb\nc\nd\ne';
  const newCode = 'a\nB\nc\nD\ne';

  it('returns exactly newCode when all hunks are enabled', () => {
    expect(applyEnabled(oldCode, newCode, {})).toBe(newCode);
  });

  it('returns exactly oldCode when every hunk is disabled', () => {
    const allOff = Object.fromEntries(
      computeHunks(oldCode, newCode).map((h) => [h.id, false]),
    );
    expect(applyEnabled(oldCode, newCode, allOff)).toBe(oldCode);
  });

  it('reconstructs the precise mixed code when the first hunk is toggled off', () => {
    // h0 off keeps old line 2 (b), h1 on takes new line 4 (D).
    expect(applyEnabled(oldCode, newCode, { h0: false })).toBe('a\nb\nc\nD\ne');
  });

  it('reconstructs the precise mixed code when the second hunk is toggled off', () => {
    // h1 off keeps old line 4 (d), h0 on takes new line 2 (B).
    expect(applyEnabled(oldCode, newCode, { h1: false })).toBe('a\nB\nc\nd\ne');
  });
});

describe('countHunks', () => {
  // Pin LITERAL counts. Asserting countHunks === computeHunks().length would be a
  // tautology (both derive from the same computeSegments()); hard-coded numbers
  // catch a regression in either one.
  it.each([
    ['added', 'a\nb\nc', 'a\nX\nb\nc', 1],
    ['deleted', 'a\nb\nc', 'a\nc', 1],
    ['changed', 'a\nb\nc', 'a\nB\nc', 1],
    ['two regions', 'a\nb\nc\nd\ne', 'a\nB\nc\nD\ne', 2],
    ['three regions', 'a\nb\nc\nd\ne', 'A\nb\nC\nd\nE', 3],
    ['identical', 'a\nb\nc', 'a\nb\nc', 0],
  ])('counts %s as %i change region(s)', (_label, oldC, newC, expected) => {
    expect(countHunks(oldC, newC)).toBe(expected);
  });
});

describe('edge cases', () => {
  it('produces no hunks for identical inputs', () => {
    expect(computeHunks('a\nb', 'a\nb')).toEqual([]);
    expect(countHunks('a\nb', 'a\nb')).toBe(0);
    expect(applyEnabled('a\nb', 'a\nb', {})).toBe('a\nb');
  });

  it('treats an empty old document as a single change adding all new lines', () => {
    // '' splits to [''], so the one change segment carries a del of '' plus the
    // added lines; round-trips remain exact.
    const hunks = computeHunks('', 'x\ny');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].rows.filter((r) => r.op === 'add').map((r) => r.text)).toEqual(['x', 'y']);
    expect(applyEnabled('', 'x\ny', {})).toBe('x\ny');
    expect(applyEnabled('', 'x\ny', { h0: false })).toBe('');
  });

  it('treats an empty new document as a single change deleting all old lines', () => {
    const hunks = computeHunks('x\ny', '');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].rows.filter((r) => r.op === 'del').map((r) => r.text)).toEqual(['x', 'y']);
    expect(applyEnabled('x\ny', '', {})).toBe('');
    expect(applyEnabled('x\ny', '', { h0: false })).toBe('x\ny');
  });
});

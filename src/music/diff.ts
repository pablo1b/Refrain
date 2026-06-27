// ---------------------------------------------------------------------------
// Line-based diff (LCS) → hunks the user can toggle individually. The staged
// edit auditions live; accepting commits the *enabled* hunks (spec §07.1).
// ---------------------------------------------------------------------------

import type { DiffHunk, DiffRow } from '../types';

interface Segment {
  equal: boolean;
  oldLines: string[];
  newLines: string[];
}

/** Longest-common-subsequence over lines → ordered equal/change segments. */
function computeSegments(oldCode: string, newCode: string): Segment[] {
  const a = oldCode.split('\n');
  const b = newCode.split('\n');
  const n = a.length;
  const m = b.length;

  // LCS table
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // backtrack into raw ops
  type Op = { t: 'eq' | 'del' | 'add'; line: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: 'eq', line: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ t: 'del', line: a[i] });
      i++;
    } else {
      ops.push({ t: 'add', line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: 'del', line: a[i++] });
  while (j < m) ops.push({ t: 'add', line: b[j++] });

  // coalesce into equal / change segments
  const segs: Segment[] = [];
  for (const op of ops) {
    const last = segs[segs.length - 1];
    if (op.t === 'eq') {
      if (last && last.equal) {
        last.oldLines.push(op.line);
        last.newLines.push(op.line);
      } else {
        segs.push({ equal: true, oldLines: [op.line], newLines: [op.line] });
      }
    } else {
      if (last && !last.equal) {
        if (op.t === 'del') last.oldLines.push(op.line);
        else last.newLines.push(op.line);
      } else {
        segs.push({
          equal: false,
          oldLines: op.t === 'del' ? [op.line] : [],
          newLines: op.t === 'add' ? [op.line] : [],
        });
      }
    }
  }
  return segs;
}

/** Build display hunks (each change segment) with one line of context each side. */
export function computeHunks(oldCode: string, newCode: string): DiffHunk[] {
  const segs = computeSegments(oldCode, newCode);
  const hunks: DiffHunk[] = [];
  let newLineNo = 1;
  let changeIdx = 0;

  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    if (seg.equal) {
      newLineNo += seg.newLines.length;
      continue;
    }
    const rows: DiffRow[] = [];
    const before = segs[s - 1];
    const after = segs[s + 1];
    if (before?.equal && before.newLines.length) {
      rows.push({ op: 'ctx', text: before.newLines[before.newLines.length - 1] });
    }
    for (const d of seg.oldLines) rows.push({ op: 'del', text: d });
    for (const ad of seg.newLines) rows.push({ op: 'add', text: ad });
    if (after?.equal && after.newLines.length) {
      rows.push({ op: 'ctx', text: after.newLines[0] });
    }
    hunks.push({
      id: `h${changeIdx++}`,
      newStart: Math.max(1, newLineNo - (before?.equal ? 1 : 0)),
      rows,
      enabled: true,
    });
    newLineNo += seg.newLines.length;
  }
  return hunks;
}

/** Reconstruct code applying only the enabled change segments. */
export function applyEnabled(oldCode: string, newCode: string, enabled: Record<string, boolean>): string {
  const segs = computeSegments(oldCode, newCode);
  const out: string[] = [];
  let changeIdx = 0;
  for (const seg of segs) {
    if (seg.equal) {
      out.push(...seg.newLines);
    } else {
      const id = `h${changeIdx++}`;
      const on = enabled[id] !== false;
      out.push(...(on ? seg.newLines : seg.oldLines));
    }
  }
  return out.join('\n');
}

export function countHunks(oldCode: string, newCode: string): number {
  return computeSegments(oldCode, newCode).filter((s) => !s.equal).length;
}

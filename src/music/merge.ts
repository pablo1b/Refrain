// ---------------------------------------------------------------------------
// Voice-granular merge (spec §12.6). §07 called merge "the hard part" and left
// it; here it is, made tractable by a fact of the medium: a Refrain score is a
// *set of named voices*, not a stream of lines. So the merge unit is the voice,
// not the character — two branches that touched *different* voices merge cleanly
// and automatically; only two branches that edited *the same* voice raise a
// conflict, and even then the choice is musical, not textual. Global settings
// (setcps) merge last-writer-wins with the loser preserved in the tree.
//
// Pure + deterministic — the inner ring. No store, no engine, no DOM.
// ---------------------------------------------------------------------------

import { parseScore, replaceBlock } from './parseScore';
import type { MergeResult, VoiceChange, ConflictChoice } from '../types';

export interface VoiceBlock {
  block: string; // the voice's full `$name:` block (definition + continuation lines)
  startLine: number; // 0-based
  endLine: number; // 0-based inclusive
}

/** Map every voice in a score to its full block text and line span. */
export function voiceBlocks(score: string): Map<string, VoiceBlock> {
  const lines = score.split('\n');
  const map = new Map<string, VoiceBlock>();
  for (const v of parseScore(score).voices) {
    map.set(v.id, { block: lines.slice(v.startLine, v.endLine + 1).join('\n'), startLine: v.startLine, endLine: v.endLine });
  }
  return map;
}

/** Delete a voice block (and one trailing blank separator, if any). */
function deleteBlock(code: string, startLine: number, endLine: number): string {
  const lines = code.split('\n');
  let end = endLine;
  if (lines[end + 1] !== undefined && lines[end + 1].trim() === '') end++;
  lines.splice(startLine, end - startLine + 1);
  return lines.join('\n');
}

function setCpsIn(code: string, cps: number): string {
  const re = /(set[Cc]ps\s*\(\s*)([\d.]+)(\s*\))/;
  // rewrite an existing setcps, or introduce one if the branch added the tempo
  return re.test(code) ? code.replace(re, `$1${cps}$3`) : `setcps(${cps})\n` + code;
}

/**
 * Three-way, voice-granular merge of two branches against their common ancestor.
 * The result's `merged` score has all disjoint (single-side) voice edits applied
 * automatically; same-voice edits are left as OURS and surfaced as `conflicts`
 * for the caller to resolve by ear (see {@link applyResolutions}).
 */
export function mergeScores(base: string, ours: string, theirs: string): MergeResult {
  const b = voiceBlocks(base);
  const o = voiceBlocks(ours);
  const t = voiceBlocks(theirs);
  const ids = new Set<string>([...b.keys(), ...o.keys(), ...t.keys()]);

  const clean: string[] = [];
  const conflicts: VoiceChange[] = [];
  const replaces: { startLine: number; endLine: number; block: string }[] = [];
  const deletes: { startLine: number; endLine: number }[] = [];
  const adds: string[] = [];

  for (const id of ids) {
    const bb = b.get(id)?.block ?? null;
    const ob = o.get(id) ?? null;
    const obText = ob?.block ?? null;
    const tb = t.get(id)?.block ?? null;
    const oursChanged = obText !== bb;
    const theirsChanged = tb !== bb;

    if (!theirsChanged) continue; // theirs didn't touch it → ours stands as-is
    if (!oursChanged) {
      // disjoint: only theirs touched this voice → take theirs automatically
      clean.push(id);
      if (tb == null) {
        if (ob) deletes.push({ startLine: ob.startLine, endLine: ob.endLine });
      } else if (ob) {
        replaces.push({ startLine: ob.startLine, endLine: ob.endLine, block: tb });
      } else {
        adds.push(tb); // theirs added a voice absent in ours + base
      }
      continue;
    }
    // both branches changed the SAME voice differently → a conflict
    if (obText === tb) continue; // …unless they landed on the same edit
    conflicts.push({ voiceId: id, base: bb, ours: obText, theirs: tb });
  }

  // apply replaces + deletes bottom-up so earlier edits don't shift later spans
  let merged = ours;
  const ops = [
    ...replaces.map((r) => ({ ...r, kind: 'r' as const })),
    ...deletes.map((d) => ({ ...d, block: '', kind: 'd' as const })),
  ].sort((a, z) => z.startLine - a.startLine);
  for (const op of ops) {
    merged = op.kind === 'd' ? deleteBlock(merged, op.startLine, op.endLine) : replaceBlock(merged, op.startLine, op.endLine, op.block);
  }
  for (const add of adds) merged = merged.replace(/\s*$/, '') + '\n\n' + add;

  // global setcps — last-writer-wins; the loser survives in the tree as a commit
  const bc = parseScore(base).cps;
  const oc = parseScore(ours).cps;
  const tc = parseScore(theirs).cps;
  const oursCpsChanged = oc !== bc;
  const theirsCpsChanged = tc !== bc;
  let cpsWinner: 'ours' | 'theirs' | null = null;
  if (theirsCpsChanged && !oursCpsChanged && tc != null) {
    merged = setCpsIn(merged, tc);
    cpsWinner = 'theirs';
  } else if (theirsCpsChanged && oursCpsChanged && oc !== tc) {
    cpsWinner = 'ours'; // HEAD is the later writer
  }

  return { merged, clean, conflicts, cpsWinner, base };
}

/**
 * Resolve same-voice conflicts into a final score. `mine` keeps the auto-merged
 * (ours) block; `theirs` swaps in the branch's version; `lanes`/`audition` keep
 * OURS as the committed text (the layering / A-B happens as a store side-effect).
 */
export function applyResolutions(result: MergeResult, choices: Record<string, ConflictChoice>): string {
  let score = result.merged;
  const wantTheirs = result.conflicts.filter((c) => choices[c.voiceId] === 'theirs');
  const blocks = voiceBlocks(score);
  // Honour "keep theirs" across all three conflict shapes: replace an existing
  // voice block, DELETE it if theirs removed the voice, or re-ADD it if ours had
  // deleted a voice theirs modified. Replaces/deletes run bottom-up; adds append.
  const edits = wantTheirs
    .map((c) => ({ c, span: blocks.get(c.voiceId) }))
    .filter((e) => e.span) // present in merged (ours) → replace or delete
    .sort((a, z) => z.span!.startLine - a.span!.startLine);
  for (const { c, span } of edits) {
    score = c.theirs == null ? deleteBlock(score, span!.startLine, span!.endLine) : replaceBlock(score, span!.startLine, span!.endLine, c.theirs);
  }
  for (const c of wantTheirs) {
    if (!blocks.has(c.voiceId) && c.theirs != null) score = score.replace(/\s*$/, '') + '\n\n' + c.theirs; // ours deleted; theirs re-adds
  }
  return score;
}

// ---------------------------------------------------------------------------
// Refrain — shared domain types
// ---------------------------------------------------------------------------

export type ThemeName = 'dark' | 'light';
export type Mode = 'studio' | 'performance';

/** A named pattern in the score: `$drums: s("bd*2")`. The voice IS the code. */
export interface Voice {
  id: string; // "drums"
  sigil: string; // "$drums"
  color: string; // resolved CSS colour
  expr: string; // expression text (everything after `$name:`)
  startLine: number; // 0-based line in the score where `$name:` lives
  endLine: number; // 0-based last line of the block (inclusive)
  muted: boolean;
  solo: boolean;
  events: number; // approx event count in one cycle (for the outline)
}

export type DiffOp = 'add' | 'del' | 'ctx';
export interface DiffRow {
  op: DiffOp;
  text: string;
}
export interface DiffHunk {
  id: string;
  /** 1-based line number in the new file where this hunk begins */
  newStart: number;
  rows: DiffRow[];
  enabled: boolean; // per-hunk accept toggle
}

/**
 * Provenance — the recipe behind a change (spec §07). Every staged edit, scene
 * and committed state remembers how it was made: the prompt, the directive, the
 * model, and the seed. This is what makes generation reproducible and the
 * history a *musical* changelog rather than a pile of text diffs.
 */
export type ProvenanceSource = 'you' | 'directive' | 'agent' | 'lanes' | 'llm' | 'prompter' | 'init' | 'merge';
export interface Provenance {
  source: ProvenanceSource;
  prompt?: string; // the natural-language ask, if any
  directive?: string; // the /verb, if any
  model?: string; // display label, e.g. "Claude Sonnet"
  thinking?: boolean; // resolved: did this turn spend the reasoning tier?
  effort?: MaestroEffort; // the per-turn effort override in force (spec §12.4)
  seed?: number; // visible generation seed (rendered hex, e.g. 0x4F2A)
  when: number; // Date.now() at creation
  cycle?: number; // integer cycle position when created
  author?: string; // who committed it — attribution in a session (spec §12.9)
}

/**
 * Per-turn effort override for the Maestro (spec §12.4). It composes with the
 * per-role routing table (§09) in ONE direction: routing sets the vendor/model
 * per role; the toggle moves the EFFORT TIER within that model, never the
 * vendor. `auto` lets the role decide — tasks think, directives don't.
 */
export type MaestroEffort = 'auto' | 'fast' | 'thinking';

/** A proposed, auditioned, reversible edit to the score. Shape 01. */
export interface StagedEdit {
  id: string;
  summary: string; // Maestro's musical description
  directive?: string;
  oldCode: string;
  newCode: string;
  hunks: DiffHunk[];
  auditioning: boolean;
  targetVoiceId?: string;
  provenance?: Provenance;
}

/**
 * A committed state in the branchable history tree (spec §07). Commits are
 * whole-score snapshots — the thing you can walk, fork and rewind — NOT editor
 * keystrokes. `parentId` gives the tree; `parked` marks a variation fork held on
 * a dashed stub off the main line. `mergeParentId` is the SECOND parent of a
 * voice-granular merge node (spec §12.6) — the branch reconciled into the line.
 */
export interface Commit {
  id: string;
  parentId: string | null;
  label: string; // "build 8-bar break" · "hand edit" · "init · nightjar"
  score: string; // full score snapshot
  voiceState: Record<string, { muted: boolean; solo: boolean }>;
  scenes: Scene[]; // arrangement snapshot
  provenance: Provenance;
  parked?: boolean; // a parked variation fork (dashed stub, not on the main line)
  mergeParentId?: string | null; // second parent of a merge node (spec §12.6)
}

/**
 * Voice-granular merge (spec §12.6). Because a Refrain score is a *set of named
 * voices*, the merge unit is the voice, not the character: two branches that
 * touched different voices union cleanly and automatically; only two branches
 * that edited the *same* voice raise a conflict, resolved by ear not by text.
 */
export interface VoiceChange {
  voiceId: string;
  base: string | null; // the voice's full block at the common ancestor (null = absent)
  ours: string | null; // …on HEAD
  theirs: string | null; // …on the branch being merged in
}
export type ConflictChoice = 'mine' | 'theirs' | 'lanes' | 'audition';
export interface MergeResult {
  /** Auto-merged score: disjoint voice edits unioned, conflicts left as OURS. */
  merged: string;
  clean: string[]; // voiceIds merged automatically (disjoint)
  conflicts: VoiceChange[]; // voiceIds edited on both sides → resolve by ear
  cpsWinner: 'ours' | 'theirs' | null; // global setcps last-writer-wins
  base: string; // the common-ancestor score used
}

export type MaestroShape = 'diff' | 'lanes' | 'answer' | 'thinking' | 'error' | 'plan';

/** A step in the Maestro's editable plan for a multi-step task (spec §03). */
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'skipped';
export interface PlanStep {
  id: string;
  text: string;
  status: PlanStepStatus;
}

/** One logged tool the agent ran — parse / query / diff / dry-run (spec §03). */
export interface ToolCall {
  id: string;
  glyph: string; // ⌗ ◷ ± ♪
  name: string; // "parse AST" · "queryArc(0,8)" · "write diff" · "dry-run audio"
  detail: string; // "→ 4 voices · 22 nodes"
  ms?: number; // timing; undefined while running
  ok: boolean; // false → surfaced as an error
}

export interface MaestroMessage {
  id: string;
  role: 'user' | 'maestro';
  text: string;
  shape?: MaestroShape;
  editId?: string;
  laneSetId?: string;
  pending?: boolean;
  // agent surfaces (spec §03) — present on multi-step turns
  reasoning?: string; // foldable reasoning trace (⌥R)
  plan?: PlanStep[];
  toolLog?: ToolCall[];
  mentions?: string[]; // @-mentioned context (voice/scene/sample ids)
}

export type LaneShape = 'sweep' | 'roll' | 'gap' | 'flat' | 'rise';
export interface Lane {
  id: string;
  label: string; // "A"
  name: string; // "filter sweep"
  desc: string; // "2 bars"
  voiceId: string; // injected as a new voice
  code: string; // full `$name: ...` to add to the score
  shape: LaneShape;
}
export interface LaneSet {
  id: string;
  prompt: string;
  lanes: Lane[];
  soloId: string | null;
  committedId: string | null;
  seed: number; // visible, reproducible generation seed (spec §07)
}

/** Shape 02 generation: a scene snapshots which voices play and how loud. */
export interface Scene {
  id: string;
  name: string;
  /** voiceId -> intensity 0..1 (0 = silent in this scene) */
  levels: Record<string, number>;
  provenance?: Provenance;
}

/**
 * A selected span of the cycle (spec §06). Start/end are cycle fractions in
 * [0,1). The clock-as-target: drag an arc, the next command scopes to it via a
 * `.mask(...)` boolean pattern. Rides into a turn like a pinned line range.
 */
export interface ArcSelection {
  start: number;
  end: number;
}

/** A pinned editor context range → a blue chip that rides into a Maestro turn (spec §02). */
export interface ContextPin {
  id: string;
  voiceId?: string; // the voice the range falls in, if any
  startLine: number; // 1-based, for display (L5–6)
  endLine: number;
}

/** Stage lenses — honest ways to see the sound, stackable (spec §05, §12.1, §12.5).
 *  `score` engraves pitched voices to a staff; `miniroll` shows the inline
 *  per-voice piano-roll in the editor gutter. */
export type LensId =
  | 'cycle'
  | 'tracker'
  | 'spectrum'
  | 'wheel'
  | 'bloom'
  | 'sparklines'
  | 'meters'
  | 'score'
  | 'miniroll';

/** Inline gutter mini-roll display per voice (spec §12.5). */
export type MiniRollMode = 'roll' | 'spark' | 'off';

/** A Prompter suggestion — an observation against the parsed tree (spec §04). */
export type PrompterKind = 'static' | 'clash' | 'empty' | 'ghost';
export interface PrompterCard {
  id: string;
  kind: PrompterKind;
  glyph: string;
  text: string; // "The pad's been static 16 cycles — open the filter?"
  code: string; // the snippet the suggestion would add
  voiceId?: string;
  action: 'directive' | 'maestro'; // how "try" opens it
  payload: string; // directive id or maestro prompt
}

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'ollama';
export interface Provider {
  id: ProviderId;
  label: string;
  key: string;
  endpoint?: string; // ollama
  model: string;
  connected: boolean;
  local?: boolean;
}

export type RoleId = 'directives' | 'generation' | 'theory' | 'offline';
export interface RoleRoute {
  id: RoleId;
  label: string;
  provider: ProviderId;
  model: string;
  strength: 'fast' | 'strong' | 'local';
}

export type Surface =
  | 'patch'
  | 'foundry'
  | 'providers'
  | 'arrangement'
  | 'notation'
  | 'history'
  | 'projects'
  | 'directives'
  | 'settings' // Keymap + Accessibility (spec §12.3, §12.8)
  | 'ports' // MIDI / OSC sync-out (spec §12.7)
  | null;

export interface LogLine {
  id: string;
  text: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

/** Result of running the Maestro brain on a turn. */
export type MaestroResult =
  | { shape: 'diff'; summary: string; newCode: string; directive?: string; targetVoiceId?: string }
  | { shape: 'lanes'; summary: string; lanes: Omit<Lane, 'id'>[]; prompt: string }
  | { shape: 'answer'; text: string }
  | { shape: 'error'; text: string };

/** A user-authored directive bound to a transform template (spec §10, principle iv). */
export interface CustomDirective {
  id: string;
  label: string;
  aliases: string[];
  /** A chain fragment appended to the target voice, e.g. `.room(0.6).lpf(700)`. */
  chain: string;
  blurb: string;
}

/** A persisted project (spec §08) — the score, history, scenes, and metadata. */
export interface ProjectMeta {
  id: string;
  name: string;
  voices: number;
  scenes: number;
  commits: number;
  updated: number; // Date.now()
}

/**
 * The transport (play/pause) binding (spec §12.3). On the desktop shell F5 is
 * ours outright; in the browser tier F5 is the reload key, so the default is
 * `mod-shift-enter` (⌘⇧⏎ — never browser-reserved). F5 is an opt-in alias.
 */
export type TransportKey = 'mod-shift-enter' | 'f5';

/**
 * Reduced-motion preference (spec §12.8). `system` follows the OS media query;
 * a manual choice in Settings → Accessibility overrides it in either direction.
 * The contract: information-bearing motion degrades to discrete steps; purely
 * decorative motion stops.
 */
export type MotionPref = 'system' | 'full' | 'reduced';

/**
 * A MIDI output the Cycle can drive as sync master (spec §12.7). The rule is
 * simple: the Cycle is always the master — Refrain sends, it does not chase.
 * A per-port latency offset compensates hardware/buffer lag.
 */
export interface MidiPort {
  id: string;
  name: string;
  enabled: boolean; // send 24-PPQN clock + transport to this port
  latencyMs: number; // ± offset so an external kick lands with the internal one
}

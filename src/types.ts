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
export type ProvenanceSource = 'you' | 'directive' | 'agent' | 'lanes' | 'llm' | 'prompter' | 'init';
export interface Provenance {
  source: ProvenanceSource;
  prompt?: string; // the natural-language ask, if any
  directive?: string; // the /verb, if any
  model?: string; // display label, e.g. "Claude Sonnet"
  thinking?: boolean; // thinking vs fast mode
  seed?: number; // visible generation seed (rendered hex, e.g. 0x4F2A)
  when: number; // Date.now() at creation
  cycle?: number; // integer cycle position when created
}

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
 * a dashed stub off the main line.
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

/** Stage lenses — honest ways to see the sound, stackable (spec §05). */
export type LensId = 'cycle' | 'tracker' | 'spectrum' | 'wheel' | 'bloom' | 'sparklines' | 'meters';

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

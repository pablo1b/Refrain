import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { seedHex, commitById } from '../state/store';
import type { Commit, Provenance, ConflictChoice, VoiceChange } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// ---------------------------------------------------------------------------
// Provenance & time-travel (spec §07). The history tree is committed states —
// not editor keystrokes — the lime ring is HEAD, dashed stubs hold parked
// variation forks. Any node opens its provenance card: the full recipe,
// reproducible by seed. Rewind (⌥Z) walks time while the music keeps playing.
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<Provenance['source'], string> = {
  you: 'you',
  directive: 'directive',
  agent: 'agent',
  lanes: 'var-set',
  llm: 'maestro',
  prompter: 'prompter',
  init: 'init',
  merge: 'merge',
};

function timeOf(when: number): string {
  try {
    return new Date(when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function History() {
  const history = useStore((s) => s.history);
  const headId = useStore((s) => s.headId);
  const rewind = useStore((s) => s.rewind);
  const forkFrom = useStore((s) => s.forkFrom);
  const reproduceCommit = useStore((s) => s.reproduceCommit);
  const mergeInto = useStore((s) => s.mergeInto);
  const [selId, setSel] = useState<string | null>(headId);

  // newest first — the walkable line (main line + parked stubs interleaved)
  const rows = [...history].reverse();
  const selected = history.find((c) => c.id === selId) ?? history.find((c) => c.id === headId) ?? null;

  return (
    <Modal tag="07 — PROVENANCE & TIME-TRAVEL" title="A history you can walk, fork and rewind" width={880}>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: '66ch', margin: '0 0 20px' }}>
        Every committed state remembers <strong>how it was made</strong> — the prompt, the directive, the seed, the
        model. Walk it, don&rsquo;t erase it: rewind to any node and the transport re-evaluates on the next boundary while
        the music keeps playing. Fork to try a different past forward. <span style={{ color: 'var(--maestro)' }}>⌥Z</span> rewinds one step.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* history tree */}
        <div style={{ border: '1px solid var(--line)', borderRadius: 11, overflow: 'hidden', background: 'var(--bg-deep)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--line)', ...mono, fontSize: 11, color: 'var(--text-2)', background: 'var(--titlebar)' }}>
            <span style={{ color: 'var(--text-1)' }}>⟐ History</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>⌥Z rewind</span>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {rows.map((c) => (
              <CommitRow
                key={c.id}
                commit={c}
                isHead={c.id === headId}
                isSel={c.id === selId}
                onSelect={() => setSel(c.id)}
              />
            ))}
          </div>
        </div>

        {/* provenance card */}
        <div>
          {selected ? (
            <ProvenanceCard
              commit={selected}
              isHead={selected.id === headId}
              history={history}
              onSelectCommit={setSel}
              onReproduce={() => reproduceCommit(selected.id)}
              onFork={() => { forkFrom(selected.id); setSel(selected.id); }}
              onRewind={() => { rewind(selected.id); setSel(selected.id); }}
              onMerge={() => mergeInto(selected.id)}
            />
          ) : (
            <div style={{ ...mono, fontSize: 12, color: 'var(--text-dim)', padding: 20 }}>Select a commit to see its recipe.</div>
          )}
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-2)', margin: '14px 2px 0' }}>
            Because the seed is stored, <em>reproduce</em> re-rolls identically, <em>nudge</em> wanders one step, <em>new</em>
            rolls fresh. Randomness becomes a value you can cite, not an accident you can&rsquo;t recover.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function CommitRow({ commit, isHead, isSel, onSelect }: { commit: Commit; isHead: boolean; isSel: boolean; onSelect: () => void }) {
  const p = commit.provenance;
  const dotColor = commit.parked
    ? 'transparent'
    : p.source === 'llm' || p.source === 'agent'
    ? 'var(--maestro)'
    : p.source === 'directive'
    ? 'var(--maestro)'
    : p.source === 'lanes'
    ? 'var(--text-2)'
    : p.source === 'init'
    ? 'var(--text-dim)'
    : 'var(--select)';
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        borderBottom: '1px solid var(--line-3)',
        background: isSel ? 'var(--active-line)' : 'transparent',
      }}
    >
      {/* graph gutter */}
      <span style={{ position: 'relative', width: 14, flex: 'none', alignSelf: 'stretch', display: 'flex', justifyContent: 'center' }}>
        <span style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--line-5)' }} />
        <span
          style={{
            position: 'relative',
            marginTop: 4,
            width: isHead ? 14 : 10,
            height: isHead ? 14 : 10,
            borderRadius: '50%',
            background: isHead ? 'transparent' : commit.parked ? 'transparent' : dotColor,
            border: isHead ? '2px solid var(--live)' : commit.parked ? '2px dashed var(--maestro-deep)' : 'none',
            boxSizing: 'border-box',
          }}
        >
          {isHead && <span style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: 'var(--live)' }} />}
        </span>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 12.5, color: commit.parked ? 'var(--text-2)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.label}</span>
          {isHead && <span style={{ ...mono, fontSize: 9, color: 'var(--live)' }}>● now</span>}
          {commit.mergeParentId && <span title="a merge — two parents (§12.6)" style={{ ...mono, fontSize: 9.5, color: 'var(--maestro)' }}>⑃ merge</span>}
        </span>
        <span style={{ ...mono, fontSize: 9.5, color: 'var(--text-dim)' }}>
          {SOURCE_LABEL[p.source]}
          {p.model ? ` · ${p.model.replace('Claude ', '')}` : ''} · {timeOf(p.when)}
        </span>
      </span>
    </button>
  );
}

function ProvenanceCard({ commit, isHead, history, onSelectCommit, onReproduce, onFork, onRewind, onMerge }: { commit: Commit; isHead: boolean; history: Commit[]; onSelectCommit: (id: string) => void; onReproduce: () => void; onFork: () => void; onRewind: () => void; onMerge: () => void }) {
  const p = commit.provenance;
  const reseed = useStore((s) => s.reseed);
  return (
    <div style={{ border: '1px solid var(--maestro-bubble-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-deep)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderBottom: '1px solid var(--line)', ...mono, fontSize: 11, color: 'var(--maestro)', background: 'var(--maestro-bubble)' }}>
        ⟐ PROVENANCE<span style={{ color: 'var(--text-2)', marginLeft: 'auto' }}>{commit.label}</span>
      </div>
      <div>
        {p.prompt && <Field label="PROMPT">“{p.prompt}”</Field>}
        {p.directive && <Field label="DIRECTIVE"><span style={{ ...mono, color: 'var(--c-string)' }}>/{p.directive}</span></Field>}
        <Field label="MODEL">{p.model ? <>{p.model}{p.thinking ? <span style={{ color: 'var(--text-3)' }}> · thinking</span> : null}</> : <span style={{ color: 'var(--text-3)' }}>deterministic · offline</span>}</Field>
        {p.seed != null && (
          <Field label="SEED">
            <span style={{ ...mono, color: 'var(--live)' }}>{seedHex(p.seed)}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
              <SeedBtn onClick={() => reseed('same')}>↻ same</SeedBtn>
              <SeedBtn onClick={() => reseed('nudge')}>+1 nudge</SeedBtn>
              <SeedBtn onClick={() => reseed('new')}>⚂ new</SeedBtn>
            </span>
          </Field>
        )}
        <Field label="WHEN">{timeOf(p.when)}{p.cycle != null ? ` · cycle ${p.cycle}` : ''}</Field>
        {/* both parents, navigable. A merge node has two (spec §12.6) and the
            second one had no UI at all — the data model tracked a parent a user
            could never see (B-6). */}
        {commit.parentId && (
          <Field label="PARENT">
            <ParentLink history={history} id={commit.parentId} onSelect={onSelectCommit} />
          </Field>
        )}
        {commit.mergeParentId && (
          <Field label="2ND PARENT">
            <span style={{ ...mono, fontSize: 10, color: 'var(--maestro)', marginRight: 7 }}>⑃ merged</span>
            <ParentLink history={history} id={commit.mergeParentId} onSelect={onSelectCommit} />
          </Field>
        )}
        {!commit.parentId && !commit.mergeParentId && (
          <Field label="PARENT"><span style={{ color: 'var(--text-3)' }}>root · no parent</span></Field>
        )}
      </div>
      <div style={{ display: 'flex', gap: 7, padding: '11px 14px', borderTop: '1px solid var(--line)', background: 'var(--bg-deeper)' }}>
        <button onClick={onReproduce} disabled={p.seed == null} style={{ ...mono, fontSize: 10, fontWeight: 700, color: 'var(--live-ink)', background: p.seed == null ? 'var(--line-5)' : 'var(--live)', borderRadius: 5, padding: '5px 11px', opacity: p.seed == null ? 0.5 : 1 }}>reproduce</button>
        <button onClick={onFork} style={{ ...mono, fontSize: 10, color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '5px 11px' }}>fork from here</button>
        <button onClick={onRewind} disabled={isHead} style={{ ...mono, fontSize: 10, color: isHead ? 'var(--text-dim)' : 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '5px 11px' }}>rewind ⌥Z</button>
        <button onClick={onMerge} disabled={isHead} title="voice-granular merge into HEAD (§12.6)" style={{ ...mono, fontSize: 10, color: isHead ? 'var(--text-dim)' : 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '5px 11px' }}>⑃ merge → HEAD</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice-granular merge conflict card (spec §12.6). Disjoint voices already merged
// automatically; here the user resolves same-voice edits by ear — keep mine,
// keep theirs, layer as variation lanes, or audition both.
// ---------------------------------------------------------------------------
const CHOICES: { id: ConflictChoice; label: string }[] = [
  { id: 'mine', label: 'keep mine' },
  { id: 'theirs', label: 'keep theirs' },
  { id: 'lanes', label: 'layer as lanes' },
  { id: 'audition', label: 'audition both' },
];

export function MergeConflictModal() {
  const pending = useStore((s) => s.pendingMerge);
  const resolveMerge = useStore((s) => s.resolveMerge);
  const cancelMerge = useStore((s) => s.cancelMerge);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  if (!pending) return null;
  const pick = (voiceId: string): ConflictChoice => choices[voiceId] ?? 'mine';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--bg-deeper) 82%, transparent)', backdropFilter: 'blur(3px)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="refr-settle" role="dialog" aria-modal="true" style={{ width: 640, maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 13, boxShadow: 'var(--shadow)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)', background: 'var(--titlebar)' }}>
          <span style={{ ...mono, fontSize: 11, letterSpacing: '.14em', color: 'var(--maestro)' }}>12.6 — MERGE</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--text)' }}>Resolve by ear, not by text</span>
        </div>
        <div style={{ padding: 18 }}>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)', margin: '0 0 16px' }}>
            Merging <strong>{pending.theirsLabel}</strong> into HEAD.
            {pending.clean.length > 0 && <> {pending.clean.length} voice{pending.clean.length === 1 ? '' : 's'} ({pending.clean.map((v) => `$${v}`).join(', ')}) merged cleanly.</>}
            {pending.cpsWinner && <> Tempo: {pending.cpsWinner === 'ours' ? 'kept HEAD’s (last writer)' : 'took the branch’s'}.</>}
            {' '}These voices were edited on both sides:
          </p>
          {pending.conflicts.map((c) => (
            <ConflictRow key={c.voiceId} change={c} choice={pick(c.voiceId)} onChoose={(ch) => setChoices((prev) => ({ ...prev, [c.voiceId]: ch }))} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--bg-deep)' }}>
          <button onClick={() => resolveMerge(choices)} style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 6, padding: '7px 14px' }}>
            merge on the next phrase ⏎
          </button>
          <button onClick={cancelMerge} style={{ ...mono, fontSize: 11, color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 6, padding: '7px 14px' }}>cancel</button>
        </div>
      </div>
    </div>
  );
}

function ConflictRow({ change, choice, onChoose }: { change: VoiceChange; choice: ConflictChoice; onChoose: (c: ConflictChoice) => void }) {
  return (
    <div style={{ border: '1px solid var(--line-4)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', background: 'var(--bg-deep)', borderBottom: '1px solid var(--line-3)', ...mono, fontSize: 11 }}>
        <span style={{ color: 'var(--c-voice)' }}>${change.voiceId}</span>
        <span style={{ color: 'var(--text-dim)' }}>edited on both branches</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--line-3)' }}>
        <Side label="MINE" code={change.ours} />
        <Side label="THEIRS" code={change.theirs} />
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '9px 13px', flexWrap: 'wrap' }}>
        {CHOICES.map((c) => {
          const on = c.id === choice;
          return (
            <button key={c.id} onClick={() => onChoose(c.id)} style={{ ...mono, fontSize: 10, color: on ? 'var(--live-ink)' : 'var(--text-1)', background: on ? 'var(--live)' : 'transparent', border: `1px solid ${on ? 'var(--live)' : 'var(--line-5)'}`, borderRadius: 5, padding: '4px 10px', fontWeight: on ? 700 : 400 }}>
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Side({ label, code }: { label: string; code: string | null }) {
  return (
    <div style={{ background: 'var(--bg-deep)', padding: '9px 12px' }}>
      <div style={{ ...mono, fontSize: 9, letterSpacing: '.14em', color: 'var(--text-dim)', marginBottom: 6 }}>{label}</div>
      <pre style={{ ...mono, fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-1)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{code ?? '— deleted —'}</pre>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--line-3)', fontSize: 12.5, color: 'var(--text-1)' }}>
      <span style={{ ...mono, fontSize: 10, color: 'var(--text-dim)', width: 64, flex: 'none' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', lineHeight: 1.45 }}>{children}</span>
    </div>
  );
}

// A navigable parent reference. Labels, not ids — ids are non-deterministic and
// meaningless to a reader; a pruned parent says so rather than showing a dead id.
// Selecting only moves the card: time travel stays behind rewind/fork.
function ParentLink({ history, id, onSelect }: { history: Commit[]; id: string; onSelect: (id: string) => void }) {
  const parent = commitById(history, id);
  if (!parent) return <span style={{ color: 'var(--text-3)' }}>no longer in history</span>;
  return (
    <button onClick={() => onSelect(parent.id)} title="select this commit" style={{ ...mono, fontSize: 11, color: 'var(--select)', textAlign: 'left' }}>
      ↑ {parent.label}
      <span style={{ color: 'var(--text-dim)' }}> · {timeOf(parent.provenance.when)}</span>
    </button>
  );
}

function SeedBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...mono, fontSize: 9.5, color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 4, padding: '3px 7px' }}>
      {children}
    </button>
  );
}

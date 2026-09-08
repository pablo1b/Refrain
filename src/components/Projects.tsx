import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { deleteProject } from '../state/projects';
import { Logo } from './Logo';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// ---------------------------------------------------------------------------
// Projects that persist (spec §08). Open with ⌘O, switch between recent sets,
// autosaved as you work. A project is the score + history tree + scenes + verbs.
// This is the browser tier — persisted locally (the desktop shell writes a real
// `.refrain` folder; same model, smaller reach). Keys are never stored here.
// ---------------------------------------------------------------------------

function ago(ms: number): string {
  const s = Math.max(0, Date.now() - ms) / 1000;
  if (s < 5) return 'just now';
  if (s < 90) return `${Math.round(s)}s ago`;
  const m = s / 60;
  if (m < 90) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 40) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Projects() {
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.projectId);
  const openProject = useStore((s) => s.openProject);
  const newProject = useStore((s) => s.newProject);
  const refresh = useStore((s) => s.hydrateFromStorage);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const list = projects.length ? projects : [{ id: activeId, name: useStore.getState().projectName, voices: useStore.getState().voices.length, scenes: 0, commits: useStore.getState().history.length, updated: Date.now() }];

  const create = () => {
    if (!name.trim()) return;
    newProject(name.trim());
    setName('');
    setCreating(false);
    useStore.getState().openSurface(null);
  };

  return (
    <Modal tag="08 — PROJECTS" title="A song that lives somewhere" width={720}>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: '64ch', margin: '0 0 18px' }}>
        A project is the score, the history tree, the scenes and your verbs — <strong>autosaved as you work</strong>, never a
        prompt. The history tree <em>is</em> the save file; <span style={{ ...mono, background: 'var(--elev)', padding: '1px 6px', borderRadius: 4 }}>⌘S</span> just tags a named checkpoint. Persisted
        locally in this browser tier; the desktop shell writes a portable <span style={{ ...mono }}>.refrain</span> folder.
      </p>

      <div style={{ border: '1px solid var(--line)', borderRadius: 11, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderBottom: '1px solid var(--line)', ...mono, fontSize: 11, color: 'var(--text-2)', background: 'var(--bg-deep)' }}>
          <span style={{ color: 'var(--text-1)' }}>⌘O recent sets</span>
          <button onClick={() => setCreating((v) => !v)} style={{ marginLeft: 'auto', ...mono, fontSize: 10.5, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 5, padding: '4px 10px' }}>+ new</button>
        </div>

        {creating && (
          <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--line-3)', background: 'var(--bg-deep)' }}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} placeholder="new set name…" style={{ flex: 1, ...mono, fontSize: 12.5, color: 'var(--text)', background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 6, padding: '7px 10px', outline: 'none' }} />
            <button onClick={create} style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 6, padding: '6px 12px' }}>create</button>
          </div>
        )}

        {list.map((p) => {
          const open = p.id === activeId;
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--line-3)', background: open ? 'var(--active-line)' : 'transparent', cursor: open ? 'default' : 'pointer' }} onClick={() => { if (!open) { openProject(p.id); useStore.getState().openSurface(null); } }}>
              <Logo size={26} live={open} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: open ? 'var(--text)' : 'var(--text-1)' }}>{p.name}</div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--text-dim)' }}>{p.voices} voices · {p.scenes} scenes · {p.commits} commits</div>
              </div>
              <div style={{ ...mono, fontSize: 10, color: open ? 'var(--live)' : 'var(--text-dim)', textAlign: 'right' }}>{open ? 'open now' : ago(p.updated)}</div>
              {!open && (
                <button onClick={(e) => { e.stopPropagation(); deleteProject(p.id); refresh(); }} title="delete" style={{ ...mono, fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '3px 8px' }}>✕</button>
              )}
            </div>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', ...mono, fontSize: 10, color: 'var(--text-dim)', background: 'var(--bg-deep)' }}>
          <span style={{ color: 'var(--voice-pad)' }}>●</span> autosaved locally · keys stay in the keychain, never in the project
        </div>
      </div>
    </Modal>
  );
}

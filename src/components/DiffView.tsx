import { useStore } from '../state/store';
import { highlightStrudel } from './Code';
import type { DiffHunk } from '../types';

const mono = { fontFamily: 'var(--font-mono)' };

export function DiffView() {
  const edit = useStore((s) => s.stagedEdit);
  const enabled = useStore((s) => s.hunkEnabled);
  const playing = useStore((s) => s.playing);
  const accept = useStore((s) => s.acceptEdit);
  const reject = useStore((s) => s.rejectEdit);
  const toggleHunk = useStore((s) => s.toggleHunk);
  if (!edit) return null;

  const hunkCount = edit.hunks.length;

  return (
    <div
      className="refr-settle"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 5,
      }}
    >
      {/* request bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 40,
          padding: '8px 14px',
          background: 'var(--titlebar)',
          borderBottom: '1px solid var(--line)',
          ...mono,
          fontSize: 11,
          color: 'var(--text-2)',
        }}
      >
        <span style={{ color: 'var(--maestro)' }}>{edit.directive ? `/${edit.directive}` : '⌘K'}</span>
        <span style={{ color: 'var(--text-1)', flex: 1, lineHeight: 1.4 }}>{plain(edit.summary)}</span>
        {playing && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--live)', flex: 'none' }}>
            <span
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--live)', animation: 'refrPulse 1.6s ease-in-out infinite' }}
            />
            auditioning · commits on downbeat
          </span>
        )}
      </div>

      {/* hunks */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
        {edit.hunks.map((h) => (
          <Hunk key={h.id} hunk={h} enabled={enabled[h.id] !== false} onToggle={() => toggleHunk(h.id)} />
        ))}
      </div>

      {/* footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 14px',
          borderTop: '1px solid var(--line)',
          background: 'var(--bg-deep)',
        }}
      >
        <span style={{ ...mono, fontSize: 11, color: 'var(--text-2)' }}>
          {hunkCount} hunk{hunkCount !== 1 ? 's' : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={accept} style={btn('var(--live)', 'var(--live-ink)', true)}>
            Accept all ⏎
          </button>
          <button onClick={reject} style={btn('transparent', 'var(--text-1)')}>
            Reject all ⌫
          </button>
        </div>
      </div>
    </div>
  );
}

function Hunk({ hunk, enabled, onToggle }: { hunk: DiffHunk; enabled: boolean; onToggle: () => void }) {
  let ln = hunk.newStart;
  return (
    <div style={{ opacity: enabled ? 1 : 0.45, transition: 'opacity .12s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px 2px 48px' }}>
        <button
          onClick={onToggle}
          title="toggle this hunk"
          style={{
            ...mono,
            fontSize: 10,
            color: enabled ? 'var(--live-ink)' : 'var(--text-2)',
            background: enabled ? 'var(--live)' : 'transparent',
            border: `1px solid ${enabled ? 'var(--live)' : 'var(--line-5)'}`,
            borderRadius: 4,
            padding: '2px 7px',
            fontWeight: 700,
          }}
        >
          {enabled ? '✓ on' : 'off'}
        </button>
        <span style={{ ...mono, fontSize: 10, color: 'var(--text-dim)' }}>hunk @ line {hunk.newStart}</span>
      </div>
      <div style={{ ...mono, fontSize: 12.5, lineHeight: 1.9 }}>
        {hunk.rows.map((r, i) => {
          const showNum = r.op !== 'del';
          const num = showNum ? ln++ : '';
          const bg =
            r.op === 'add' ? 'var(--diff-add-bg)' : r.op === 'del' ? 'var(--diff-del-bg)' : 'transparent';
          const border =
            r.op === 'add' ? 'var(--diff-add-line)' : r.op === 'del' ? 'var(--diff-del-line)' : 'transparent';
          return (
            <div key={i} style={{ display: 'flex', background: bg, borderLeft: `2px solid ${border}` }}>
              <span style={{ width: 34, textAlign: 'right', paddingRight: 8, color: 'var(--gutter)', userSelect: 'none', flex: 'none' }}>
                {num}
              </span>
              <span style={{ width: 16, flex: 'none', color: r.op === 'add' ? 'var(--diff-add-mark)' : r.op === 'del' ? 'var(--diff-del-text)' : 'transparent' }}>
                {r.op === 'add' ? '+' : r.op === 'del' ? '−' : ''}
              </span>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', flex: 1, paddingRight: 12 }}>
                {r.op === 'del' ? (
                  <span style={{ color: 'var(--diff-del-text)', textDecoration: 'line-through' }}>{r.text}</span>
                ) : (
                  highlightStrudel(r.text)
                )}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function plain(summary: string): string {
  return summary.replace(/\*\*|\*|`/g, '');
}

function btn(bg: string, color: string, bold = false): React.CSSProperties {
  return {
    ...mono,
    fontSize: 11,
    color,
    background: bg,
    border: bg === 'transparent' ? '1px solid var(--line-5)' : 'none',
    borderRadius: 6,
    padding: '6px 13px',
    fontWeight: bold ? 700 : 400,
  };
}

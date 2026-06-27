import { useStore } from '../state/store';
import { highlightStrudel } from './Code';
import type { Lane, LaneShape } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

function LaneSpark({ shape, color }: { shape: LaneShape; color: string }) {
  // tiny waveform per lane (spec Fig 7.2)
  if (shape === 'sweep')
    return (
      <svg width="100%" height="28" viewBox="0 0 200 28" preserveAspectRatio="none">
        <path d="M0 14 Q25 4 50 14 T100 14 T150 14 T200 14" stroke={color} strokeWidth="1.4" fill="none" />
      </svg>
    );
  if (shape === 'roll')
    return (
      <svg width="100%" height="28" viewBox="0 0 200 28" preserveAspectRatio="none">
        <g stroke={color} strokeWidth="1.4">
          {[10, 34, 58, 82, 106, 124, 140, 154, 166, 178, 190].map((x, i) => (
            <line key={i} x1={x} y1="22" x2={x} y2={Math.max(2, 20 - i * 2)} />
          ))}
        </g>
      </svg>
    );
  if (shape === 'gap')
    return (
      <svg width="100%" height="28" viewBox="0 0 200 28" preserveAspectRatio="none">
        <line x1="0" y1="14" x2="180" y2="14" stroke="var(--line-6)" strokeWidth="1.2" />
        <line x1="184" y1="24" x2="184" y2="3" stroke={color} strokeWidth="2" />
      </svg>
    );
  if (shape === 'rise')
    return (
      <svg width="100%" height="28" viewBox="0 0 200 28" preserveAspectRatio="none">
        <path d="M0 24 L200 4" stroke={color} strokeWidth="1.4" fill="none" />
      </svg>
    );
  return (
    <svg width="100%" height="28" viewBox="0 0 200 28" preserveAspectRatio="none">
      <g stroke={color} strokeWidth="1.2">
        {Array.from({ length: 16 }).map((_, i) => (
          <line key={i} x1={6 + i * 12} y1="20" x2={6 + i * 12} y2={8 + (i % 3) * 3} />
        ))}
      </g>
    </svg>
  );
}

export function VariationLanes({ laneSetId }: { laneSetId: string }) {
  const laneSet = useStore((s) => s.laneSet);
  const soloLane = useStore((s) => s.soloLane);
  const commitLane = useStore((s) => s.commitLane);
  const reroll = useStore((s) => s.rerollLanes);
  if (!laneSet || laneSet.id !== laneSetId) {
    return <div style={{ ...mono, fontSize: 11, color: 'var(--text-dim)' }}>— forks parked in the tree —</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {laneSet.lanes.map((lane) => (
          <LaneCard
            key={lane.id}
            lane={lane}
            soloing={laneSet.soloId === lane.id}
            committed={laneSet.committedId === lane.id}
            onSolo={() => soloLane(laneSet.soloId === lane.id ? null : lane.id)}
            onCommit={() => commitLane(lane.id)}
          />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...mono, fontSize: 10.5, color: 'var(--text-dim)' }}>
        <span>⌥ tree · {laneSet.lanes.length} forks · parked until committed</span>
        <button onClick={reroll} style={{ marginLeft: 'auto', color: 'var(--text-1)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '4px 9px' }}>
          re-roll ↻
        </button>
      </div>
    </div>
  );
}

function LaneCard({ lane, soloing, committed, onSolo, onCommit }: { lane: Lane; soloing: boolean; committed: boolean; onSolo: () => void; onCommit: () => void }) {
  const accent = soloing ? 'var(--live)' : 'var(--voice-pad)';
  return (
    <div
      style={{
        background: soloing ? 'var(--lane-sel)' : 'var(--bg-deep)',
        border: `1px solid ${soloing ? 'var(--lane-sel-line)' : 'var(--line-3)'}`,
        borderRadius: 8,
        padding: 12,
        opacity: committed ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ ...mono, fontSize: 12, color: 'var(--text)' }}>
          {lane.label} · <span style={{ color: accent }}>{lane.name}</span>
        </span>
        <span style={{ ...mono, fontSize: 10, color: soloing ? 'var(--live)' : 'var(--text-dim)' }}>{soloing ? '▸ soloing' : lane.desc}</span>
      </div>
      <LaneSpark shape={lane.shape} color={accent} />
      <pre style={{ ...mono, fontSize: 10.5, lineHeight: 1.6, color: 'var(--text-2)', margin: '8px 0', whiteSpace: 'pre-wrap' }}>{highlightStrudel(lane.code)}</pre>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onSolo} style={{ ...mono, fontSize: 10, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 5, padding: '5px 10px' }}>
          {soloing ? '▣ soloing' : '▶ solo'}
        </button>
        <button
          onClick={onCommit}
          style={{ ...mono, fontSize: 10, fontWeight: 700, color: committed ? 'var(--text-2)' : 'var(--live-ink)', background: committed ? 'transparent' : 'var(--maestro)', border: committed ? '1px solid var(--line-5)' : 'none', borderRadius: 5, padding: '5px 10px' }}
        >
          {committed ? '✓ committed' : 'commit'}
        </button>
      </div>
    </div>
  );
}

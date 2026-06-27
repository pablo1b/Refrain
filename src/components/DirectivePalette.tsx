import { DIRECTIVES, type Directive, type DirectiveGroup } from '../music/directives';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const GROUP_ORDER: DirectiveGroup[] = ['DYNAMICS', 'AGOGICS', 'ARTICULATION', 'CHARACTER', 'GESTURE'];

export function filterDirectives(query: string): Directive[] {
  const q = query.trim().toLowerCase();
  if (!q) return DIRECTIVES;
  return DIRECTIVES.filter(
    (d) => d.id.includes(q) || d.label.toLowerCase().includes(q) || d.blurb.includes(q) || d.aliases.some((a) => a.includes(q)),
  );
}

export function DirectivePalette({
  query,
  onPick,
  highlightId,
}: {
  query: string;
  onPick: (d: Directive) => void;
  highlightId?: string;
}) {
  const list = filterDirectives(query);
  const grouped = GROUP_ORDER.map((g) => ({ g, items: list.filter((d) => d.group === g) })).filter((x) => x.items.length);

  return (
    <div
      className="refr-settle"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 0,
        right: 0,
        maxHeight: 320,
        overflowY: 'auto',
        background: 'var(--elev-3)',
        border: '1px solid var(--line-4)',
        borderRadius: 10,
        boxShadow: 'var(--shadow)',
        zIndex: 20,
        padding: '6px 0',
      }}
    >
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: '.16em', color: 'var(--text-dim)', padding: '6px 14px 8px' }}>
        DIRECTIVES — musical verbs · ↵ to run
      </div>
      {grouped.length === 0 && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-2)' }}>no directive matches “{query}”</div>
      )}
      {grouped.map(({ g, items }) => (
        <div key={g}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.12em', color: 'var(--maestro)', padding: '8px 14px 4px' }}>{g}</div>
          {items.map((d) => (
            <button
              key={d.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(d);
              }}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 12,
                width: '100%',
                textAlign: 'left',
                padding: '7px 14px',
                background: d.id === highlightId ? 'var(--active-line)' : 'transparent',
              }}
            >
              <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, color: 'var(--text)', minWidth: 118 }}>
                {d.label}
              </span>
              <span style={{ ...mono, fontSize: 11.5, color: 'var(--c-voice)', minWidth: 150 }}>{d.codeHint}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>— {d.blurb}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

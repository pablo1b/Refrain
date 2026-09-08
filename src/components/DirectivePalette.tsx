import { DIRECTIVES, COMMANDS, type DirectiveGroup } from '../music/directives';
import type { CustomDirective } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// A unified palette item — the slash menu opened all the way (spec §03.2):
// generation & questions (commands) + the directive vocabulary + your verbs.
export interface PaletteItem {
  kind: 'command' | 'directive';
  id: string;
  label: string;
  group: string;
  hint: string;
  blurb: string;
}

const GROUP_ORDER = ['GENERATE', 'ASK', 'DYNAMICS', 'AGOGICS', 'ARTICULATION', 'CHARACTER', 'GESTURE', 'YOURS'];

function allItems(custom: CustomDirective[]): PaletteItem[] {
  const cmds: PaletteItem[] = COMMANDS.map((c) => ({ kind: 'command', id: c.id, label: c.label, group: c.group, hint: '', blurb: c.blurb }));
  const dirs: PaletteItem[] = DIRECTIVES.map((d) => ({ kind: 'directive', id: d.id, label: d.label, group: d.group as DirectiveGroup, hint: d.codeHint, blurb: d.blurb }));
  const yours: PaletteItem[] = custom.map((c) => ({ kind: 'directive', id: c.id, label: c.label, group: 'YOURS', hint: c.chain, blurb: c.blurb }));
  return [...cmds, ...dirs, ...yours];
}

export function filterPalette(query: string, custom: CustomDirective[]): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const items = allItems(custom);
  if (!q) return items;
  return items.filter((d) => d.id.includes(q) || d.label.toLowerCase().includes(q) || d.blurb.toLowerCase().includes(q));
}

export function DirectivePalette({
  query,
  onPick,
  highlightId,
  custom,
}: {
  query: string;
  onPick: (item: PaletteItem) => void;
  highlightId?: string;
  custom: CustomDirective[];
}) {
  const list = filterPalette(query, custom);
  const grouped = GROUP_ORDER.map((g) => ({ g, items: list.filter((d) => d.group === g) })).filter((x) => x.items.length);

  return (
    <div
      className="refr-settle"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 0,
        right: 0,
        maxHeight: 340,
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
        COMMANDS &amp; DIRECTIVES · ↑↓ ⏎ · @ references a voice
      </div>
      {grouped.length === 0 && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-2)' }}>no match for “{query}”</div>}
      {grouped.map(({ g, items }) => (
        <div key={g}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.12em', color: 'var(--maestro)', padding: '8px 14px 4px' }}>{g}</div>
          {items.map((d) => (
            <button
              key={`${d.kind}:${d.id}`}
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
              <span style={{ fontFamily: d.kind === 'command' ? 'var(--font-mono)' : 'var(--font-display)', fontStyle: d.kind === 'command' ? 'normal' : 'italic', fontSize: d.kind === 'command' ? 12.5 : 15, color: 'var(--text)', minWidth: 118 }}>
                {d.kind === 'command' ? d.label : d.label}
              </span>
              {d.hint && <span style={{ ...mono, fontSize: 11.5, color: 'var(--c-voice)', minWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.hint}</span>}
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>— {d.blurb}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

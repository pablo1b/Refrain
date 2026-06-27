import React from 'react';
import { highlightStrudel } from './Code';

// Minimal inline renderer: `code` (Strudel-highlighted), **bold**, *italic*.
export function renderRich(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const parts = text.split(/(`[^`]+`)/g);
  let k = 0;
  for (const part of parts) {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      out.push(
        <span key={k++} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92em', background: 'color-mix(in srgb, var(--maestro) 12%, transparent)', borderRadius: 4, padding: '0 4px' }}>
          {highlightStrudel(part.slice(1, -1))}
        </span>,
      );
    } else {
      out.push(...renderEmph(part, () => k++));
    }
  }
  return out;
}

function renderEmph(text: string, nextKey: () => number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={nextKey()} style={{ color: 'var(--maestro)', fontWeight: 700 }}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={nextKey()}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

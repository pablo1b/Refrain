import React from 'react';

// A tiny regex tokenizer for inline Strudel — used in diffs, lane previews and
// Maestro bubbles where a full CodeMirror instance would be overkill. Colours
// come from the themed `--c-*` vars so light/dark both look right.
const TOKEN = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(\$[A-Za-z_]\w*)|(\b\d+(?:\.\d+)?(?:e\d+)?\b)|([A-Za-z_]\w*)|([(){}\[\].,:+\-*/<>])/g;

export function highlightStrudel(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  let k = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [full, comment, str, sigil, num, word, punct] = m;
    let color: string | undefined;
    let italic = false;
    if (comment) {
      color = 'var(--c-comment)';
      italic = true;
    } else if (str) color = 'var(--c-string)';
    else if (sigil) color = 'var(--c-voice)';
    else if (num) color = 'var(--c-num)';
    else if (word) color = 'var(--c-func)';
    else if (punct) color = 'var(--c-punct)';
    out.push(
      <span key={k++} style={{ color, fontStyle: italic ? 'italic' : undefined }}>
        {full}
      </span>,
    );
    last = m.index + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

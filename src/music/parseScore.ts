// ---------------------------------------------------------------------------
// Parse a Strudel score into named voices. The `$name: expr` ("$:" mini-stack)
// syntax is Strudel's. A voice block is the `$name:` line plus any following
// *indented* continuation lines (the chained `.method(...)` calls).
// ---------------------------------------------------------------------------

export interface ParsedVoice {
  id: string;
  sigil: string; // "$drums"
  expr: string; // text after the colon, continuation lines joined with \n
  startLine: number; // 0-based
  endLine: number; // 0-based (inclusive)
  indent: string; // leading whitespace of continuation lines, for new chains
  events: number; // rough event estimate for one cycle
}

export interface ParsedScore {
  voices: ParsedVoice[];
  cps: number | null;
  cpsLine: number | null;
}

const VOICE_RE = /^(\s*)\$([A-Za-z_][\w-]*)\s*:(.*)$/;
const CPS_RE = /set[Cc]ps\s*\(\s*([\d.]+)\s*\)/;

export function parseScore(code: string): ParsedScore {
  const lines = code.split('\n');
  const voices: ParsedVoice[] = [];
  let cps: number | null = null;
  let cpsLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (cps === null) {
      const cm = line.match(CPS_RE);
      if (cm) {
        cps = parseFloat(cm[1]);
        cpsLine = i;
      }
    }

    const m = line.match(VOICE_RE);
    if (!m) continue;

    const [, , id, rest] = m;
    const sigil = '$' + id;
    let endLine = i;
    let indent = '       ';
    const exprParts = [rest.trimEnd()];

    // gather indented continuation lines
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (next.trim() === '') break; // blank line ends a block
      if (VOICE_RE.test(next)) break; // next voice
      if (/^\S/.test(next)) break; // a new top-level statement (no indent)
      // indented line -> continuation
      const lead = next.match(/^(\s*)/)?.[1];
      if (lead && lead.length) indent = lead;
      exprParts.push(next.trimEnd());
      endLine = j;
    }

    const expr = exprParts.join('\n').trim();
    voices.push({
      id,
      sigil,
      expr,
      startLine: i,
      endLine,
      indent,
      events: estimateEvents(expr),
    });
    i = endLine;
  }

  return { voices, cps, cpsLine };
}

/** Rough count of events in one cycle from the first mini-notation string. */
export function estimateEvents(expr: string): number {
  const strMatch = expr.match(/"([^"]*)"/);
  if (!strMatch) return 1;
  return estimateMini(strMatch[1]);
}

function estimateMini(pattern: string): number {
  // strip angle-bracket alternations (they cycle, ~1 per cycle)
  let p = pattern.replace(/<[^>]*>/g, 'x');
  // handle top-level comma stacks: take the max branch
  if (p.includes(',') && !/[[\]]/.test(p)) {
    return Math.max(...p.split(',').map((b) => estimateMini(b.trim())));
  }
  // remove brackets (sub-sequences count as their token count, approx)
  p = p.replace(/[[\]]/g, ' ');
  const tokens = p.trim().split(/\s+/).filter(Boolean);
  let count = 0;
  for (const tok of tokens) {
    if (tok === '~' || tok === '-') {
      count += 1; // a rest still occupies a step
      continue;
    }
    const mul = tok.match(/\*(\d+)/);
    count += mul ? parseInt(mul[1], 10) : 1;
  }
  return Math.max(1, Math.min(count, 64));
}

/** Replace a voice block (startLine..endLine inclusive) with new text. */
export function replaceBlock(
  code: string,
  startLine: number,
  endLine: number,
  newBlock: string,
): string {
  const lines = code.split('\n');
  const before = lines.slice(0, startLine);
  const after = lines.slice(endLine + 1);
  return [...before, ...newBlock.split('\n'), ...after].join('\n');
}

/** Strip the `$name:` sigil prefix so the expression can be evaluated alone. */
export function voiceExprForEval(v: ParsedVoice): string {
  return v.expr;
}

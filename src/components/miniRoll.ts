// ---------------------------------------------------------------------------
// The gutter mini-roll (spec §12.5) — a bar of music beside its line. The
// Tracker's lane for ONE voice, one cycle, a few pixels tall, rendered inline in
// the editor gutter. It shares the Tracker's data (queryArc events) and the
// colour-per-voice, so the inline roll and the panel never disagree. Per voice
// it collapses to a Sparkline or off; with the Score lens active a pitched voice
// shows a one-bar staff snippet instead of a flat roll.
//
// Pure DOM (no React) so it can live inside a CodeMirror GutterMarker.
// ---------------------------------------------------------------------------

import type { EngineEvent } from '../audio/strudelEngine';
import { analyzeVoiceForScore } from '../music/notation';

const NS = 'http://www.w3.org/2000/svg';
const W = 92;
const H = 14;

function svgEl(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.display = 'block';
  return svg;
}

function rect(x: number, y: number, w: number, h: number, fill: string, opacity = 1): SVGRectElement {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', x.toFixed(2));
  r.setAttribute('y', y.toFixed(2));
  r.setAttribute('width', Math.max(1, w).toFixed(2));
  r.setAttribute('height', h.toFixed(2));
  r.setAttribute('rx', '1');
  r.setAttribute('fill', fill);
  if (opacity !== 1) r.setAttribute('opacity', opacity.toFixed(2));
  return r;
}

export interface MiniRollOpts {
  events: EngineEvent[];
  color: string;
  mode: 'roll' | 'spark';
  expr: string;
  scoreLens: boolean;
}

/** Build the inline mini-roll SVG for one voice. */
export function buildMiniRoll({ events, color, mode, expr, scoreLens }: MiniRollOpts): SVGSVGElement {
  const svg = svgEl();

  // Score lens active + a pitched voice → a one-bar staff snippet (contour),
  // instead of the flat rhythm roll (spec §12.5).
  if (scoreLens) {
    const eng = analyzeVoiceForScore(expr);
    if (eng.engravable && eng.mode === 'melodic' && eng.notes.length) {
      const ds = eng.notes.map((n) => n.diatonic);
      const lo = Math.min(...ds);
      const hi = Math.max(...ds);
      const span = Math.max(1, hi - lo);
      for (const n of eng.notes) {
        const cx = 3 + n.x * (W - 8);
        const cy = H - 2 - ((n.diatonic - lo) / span) * (H - 4);
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', cx.toFixed(2));
        dot.setAttribute('cy', cy.toFixed(2));
        dot.setAttribute('r', '2');
        dot.setAttribute('fill', color);
        svg.appendChild(dot);
      }
      return svg;
    }
  }

  if (!events.length) return svg;

  if (mode === 'spark') {
    // a thin rhythm spark: a tick per onset, height by gain
    for (const e of events) {
      const x = e.begin * (W - 2);
      const h = Math.max(3, Math.min(1, e.gain) * (H - 2));
      svg.appendChild(rect(x, H - h, 1.4, h, color, e.gain <= 0.001 ? 0.3 : 0.9));
    }
    return svg;
  }

  // roll: a block per event across the cycle (the Tracker lane, shrunk)
  for (const e of events) {
    const x = e.begin * W;
    const w = Math.max(2, (e.dur || 0.03) * W);
    svg.appendChild(rect(x, 4, w, H - 8, color, e.gain <= 0.001 ? 0.25 : Math.max(0.4, Math.min(1, e.gain))));
  }
  return svg;
}

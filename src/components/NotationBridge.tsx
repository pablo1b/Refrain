import { useStore } from '../state/store';
import { Modal } from './Modal';
import { highlightStrudel } from './Code';
import { parseScore, replaceBlock } from '../music/parseScore';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// borrowed-chord / modal-interchange substitutions (key-respecting-ish)
const REHARM: Record<string, { to: string; roman: string }> = {
  Abmaj7: { to: 'Fm9', roman: 'iv⁹' },
  Fmaj7: { to: 'Fm7', roman: 'iv⁷' },
  G7: { to: 'Ab7', roman: '♭II⁷' },
  Cmaj7: { to: 'Am9', roman: 'vi⁹' },
  Eb: { to: 'Cm7', roman: 'i⁷' },
};

function reharmonize(token: string): { to: string; roman: string } {
  if (REHARM[token]) return REHARM[token];
  if (/maj7/.test(token)) return { to: token.replace('maj7', 'm9'), roman: 'borrowed iv' };
  if (/m7$/.test(token)) return { to: token.replace('m7', 'm9'), roman: 'extended' };
  if (/7$/.test(token)) return { to: token.replace('7', '9'), roman: 'extended' };
  return { to: token + 'maj7', roman: 'extended' };
}

function Staff({ rows, accentLast }: { rows: number[][]; accentLast?: boolean }) {
  return (
    <svg width="100%" height="92" viewBox="0 0 280 92">
      <g stroke="var(--line-6)" strokeWidth="1">
        {[22, 33, 44, 55, 66].map((y) => (
          <line key={y} x1="0" y1={y} x2="280" y2={y} />
        ))}
      </g>
      <text x="4" y="60" fontFamily="var(--font-display)" fontSize="42" fill="var(--text)">
        𝄞
      </text>
      {rows.map((chord, ci) => {
        const x = 95 + ci * 90;
        const accent = accentLast && ci === rows.length - 1;
        return (
          <g key={ci} fill={accent ? 'var(--live)' : 'var(--text)'}>
            {chord.map((y, ni) => (
              <ellipse key={ni} cx={x} cy={y} rx="6" ry="4.4" transform={`rotate(-18 ${x} ${y})`} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function NotationBridge() {
  const score = useStore((s) => s.score);
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const stageEdit = useStore((s) => s.stageEdit);
  const close = useStore((s) => s.openSurface);

  const { voices } = parseScore(score);
  const voice = voices.find((v) => v.id === activeVoiceId && /note\(|n\(/.test(v.expr)) ?? voices.find((v) => /note\("/.test(v.expr));

  const chordMatch = voice?.expr.match(/note\("([^"]*)"\)/);
  const tokens = chordMatch ? chordMatch[1].replace(/[<>]/g, '').trim().split(/\s+/) : [];
  const lastChord = tokens[tokens.length - 1] ?? '';
  const sub = lastChord ? reharmonize(lastChord) : { to: '', roman: '' };

  const doReharm = () => {
    if (!voice || !lastChord) return;
    const block = score.split('\n').slice(voice.startLine, voice.endLine + 1).join('\n');
    const newBlock = block.replace(lastChord, sub.to);
    const newScore = replaceBlock(score, voice.startLine, voice.endLine, newBlock);
    stageEdit(`Reharmonise **${voice.sigil}** — \`${lastChord}\` → \`${sub.to}\` (${sub.roman}). Stays in key; preview on staff + audio.`, newScore, { directive: 'reharmonise' });
    close(null);
  };

  return (
    <Modal tag="7.5 — NOTATION BRIDGE" title="Read it as a score, command it as theory" width={760}>
      {!voice ? (
        <div style={{ border: '1px dashed var(--line-5)', borderRadius: 10, padding: 28, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
          Select a pitched voice (one with <code style={mono}>note(…)</code>) in the outline to see it on the staff.
        </div>
      ) : (
        <>
          <div style={{ ...mono, fontSize: 11, color: 'var(--text-2)', marginBottom: 14 }}>
            <span style={{ color: 'var(--c-voice)' }}>{voice.sigil}</span> · notation bridge
            <span style={{ color: 'var(--maestro)', marginLeft: 12 }}>/reharmonise → modal interchange</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: 'var(--elev-3)', padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: 'var(--text-3)', marginBottom: 10 }}>BEFORE</div>
              <Staff rows={[[55, 44, 33], [50, 39, 28]]} />
              <div style={{ display: 'flex', gap: 30, fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, color: 'var(--text-2)', marginTop: 6 }}>
                <span style={{ marginLeft: 78 }}>i⁷</span>
                <span>{tokens[0] ? '♭VI' : 'V'}</span>
              </div>
            </div>
            <div style={{ background: 'var(--lane-sel)', padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: 'var(--live)', marginBottom: 10 }}>AFTER · {sub.roman}</div>
              <Staff rows={[[55, 44, 33], [55, 44, 36]]} accentLast />
              <div style={{ display: 'flex', gap: 30, fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, color: 'var(--text-2)', marginTop: 6 }}>
                <span style={{ marginLeft: 78 }}>i⁷</span>
                <span style={{ color: 'var(--live)' }}>{sub.roman}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <pre style={{ flex: 1, ...mono, fontSize: 11.5, margin: 0, whiteSpace: 'pre-wrap' }}>
              {highlightStrudel(`${voice.sigil}: note("… ${sub.to}")`)} <span style={{ color: 'var(--c-comment)' }}>// was {lastChord}</span>
            </pre>
            <button onClick={doReharm} style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--live-ink)', background: 'var(--live)', borderRadius: 6, padding: '7px 13px' }}>
              stage reharmonise ⏎
            </button>
          </div>
          <p style={{ ...mono, fontSize: 10.5, color: 'var(--text-3)', marginTop: 12 }}>
            Substitute glyphs stand in for engraved notation — the bridge says “this is better read as code” where a clean staff can’t hold it.
          </p>
        </>
      )}
    </Modal>
  );
}

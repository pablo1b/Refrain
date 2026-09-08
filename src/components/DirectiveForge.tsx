import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { DIRECTIVES } from '../music/directives';
import { highlightStrudel } from './Code';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// ---------------------------------------------------------------------------
// Author-your-own directives (spec §10, principle iv). A directive is bindable:
// name a verb, attach a transform (a chain fragment appended to the target
// voice), save it to your pack. It then appears in the palette and runs like a
// built-in — deterministic and inspectable. The vocabulary is finally yours.
// ---------------------------------------------------------------------------

export function DirectiveForge() {
  const custom = useStore((s) => s.customDirectives);
  const add = useStore((s) => s.addCustomDirective);
  const remove = useStore((s) => s.removeCustomDirective);

  const [label, setLabel] = useState('');
  const [chain, setChain] = useState('.room(0.5).lpf(1200)');
  const [blurb, setBlurb] = useState('');
  const [aliases, setAliases] = useState('');

  const valid = label.trim().length > 0 && /^\.\w/.test(chain.trim());

  const save = () => {
    if (!valid) return;
    add({
      label: label.trim(),
      chain: chain.trim(),
      blurb: blurb.trim() || `applies ${chain.trim()}`,
      aliases: aliases.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
    });
    setLabel('');
    setBlurb('');
    setAliases('');
  };

  return (
    <Modal tag="10 — DIRECTIVE FORGE" title="Author your own verbs" width={760}>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: '64ch', margin: '0 0 20px' }}>
        A directive is a bounded, reproducible transform. Name a verb, attach a Strudel chain fragment, and it joins the
        palette — summoned by <span style={{ ...mono, background: 'var(--elev)', padding: '1px 6px', borderRadius: 4 }}>/</span> and run like a built-in.
        Every method must be real Strudel. It appends to the <em>active</em> voice.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* editor */}
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldInput label="Verb name" placeholder="shimmer" value={label} onChange={setLabel} />
          <FieldInput label="Chain fragment" placeholder=".room(0.5).lpf(1200)" value={chain} onChange={setChain} monoFont />
          <FieldInput label="Aliases (comma-sep)" placeholder="glisten, sparkle" value={aliases} onChange={setAliases} />
          <FieldInput label="Gloss" placeholder="adds air and sheen" value={blurb} onChange={setBlurb} />
          <div style={{ ...mono, fontSize: 11, color: 'var(--text-dim)', background: 'var(--bg-deep)', border: '1px solid var(--line-3)', borderRadius: 6, padding: '8px 10px' }}>
            preview · <span style={{ color: 'var(--c-voice)' }}>$active</span>
            {chain.trim() ? highlightStrudel(chain.trim()) : <span style={{ color: 'var(--text-dim)' }}> .method(…)</span>}
          </div>
          <button onClick={save} disabled={!valid} style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--live-ink)', background: valid ? 'var(--live)' : 'var(--line-5)', borderRadius: 7, padding: '8px 13px', opacity: valid ? 1 : 0.6 }}>
            bind directive
          </button>
        </div>

        {/* your pack */}
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ ...mono, fontSize: 10.5, letterSpacing: '.14em', color: 'var(--maestro)', padding: '11px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-deep)' }}>
            YOUR PACK · {custom.length}
          </div>
          {custom.length === 0 ? (
            <div style={{ padding: 18, fontSize: 13, color: 'var(--text-2)' }}>No custom verbs yet. Bind one on the left — it joins the {DIRECTIVES.length} built-ins.</div>
          ) : (
            custom.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line-3)' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, color: 'var(--text)', minWidth: 90 }}>{d.label}</span>
                <span style={{ ...mono, fontSize: 11, color: 'var(--c-voice)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.chain}</span>
                <button onClick={() => remove(d.id)} title="remove" style={{ ...mono, fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--line-5)', borderRadius: 5, padding: '3px 8px' }}>✕</button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

function FieldInput({ label, placeholder, value, onChange, monoFont }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; monoFont?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ ...mono, fontSize: 10, letterSpacing: '.1em', color: 'var(--text-dim)' }}>{label.toUpperCase()}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ fontFamily: monoFont ? 'var(--font-mono)' : 'var(--font-ui)', fontSize: 12.5, color: 'var(--text)', background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 6, padding: '7px 10px', outline: 'none' }}
      />
    </label>
  );
}

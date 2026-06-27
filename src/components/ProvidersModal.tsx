import { useStore } from '../state/store';
import { Modal } from './Modal';
import { MODEL_OPTIONS } from '../llm/providers';
import type { Provider, RoleRoute } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

export function ProvidersModal() {
  const providers = useStore((s) => s.providers);
  const roles = useStore((s) => s.roles);
  const localOnly = useStore((s) => s.localOnly);
  const setKey = useStore((s) => s.setProviderKey);
  const setRoleProvider = useStore((s) => s.setRoleProvider);
  const toggleLocal = useStore((s) => s.toggleLocalOnly);

  return (
    <Modal tag="7.8 — PROVIDERS & ROUTING" title="Bring your own keys; route by task" width={820}>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: '64ch', margin: '0 0 22px' }}>
        Refrain is fully usable with no keys — directives & lanes are deterministic and run offline. Add a key to let the
        Maestro handle free-form requests, then <strong>map each role to any provider &amp; model</strong> on the right — cheap/fast for
        directives, a stronger model for generation, a local one for offline gigs. Keys & routing are stored locally in this
        browser (the desktop build uses the OS keychain).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* providers */}
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          <Header>PROVIDERS · BYOK</Header>
          {providers.map((p, i) => (
            <ProviderRow key={p.id} p={p} first={i === 0} onKey={(k) => setKey(p.id, k)} />
          ))}
        </div>
        {/* routing */}
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          <Header>ROLE → MODEL</Header>
          {roles.map((r, i) => (
            <RoleRow key={r.id} role={r} providers={providers} first={i === 0} onChange={setRoleProvider} />
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderTop: '1px solid var(--line)', background: 'var(--bg-deep)' }}>
            <span style={{ fontSize: 13.5, color: 'var(--text)', flex: 1, fontWeight: 600 }}>Local-only mode</span>
            <button onClick={toggleLocal} aria-pressed={localOnly} style={{ width: 36, height: 20, borderRadius: 999, background: localOnly ? 'var(--live)' : 'var(--line-6)', position: 'relative', transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 2, left: localOnly ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </button>
          </div>
        </div>
      </div>
      <p style={{ ...mono, fontSize: 11, color: 'var(--text-3)', marginTop: 14 }}>
        Local-only stops every network call — a gig laptop owes nothing to the network.
      </p>
    </Modal>
  );
}

const selectStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--text-1)',
  background: 'var(--elev-3)',
  border: '1px solid var(--line-4)',
  borderRadius: 6,
  padding: '4px 6px',
  outline: 'none',
  maxWidth: 130,
};

function RoleRow({
  role,
  providers,
  first,
  onChange,
}: {
  role: RoleRoute;
  providers: Provider[];
  first: boolean;
  onChange: (id: RoleRoute['id'], provider: Provider['id'], model: string) => void;
}) {
  const tint = role.strength === 'fast' ? 'var(--c-voice)' : role.strength === 'local' ? 'var(--text-2)' : 'var(--maestro)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: first ? 'none' : '1px solid var(--line-3)' }}>
      <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 0 }}>{role.label}</span>
      <span title={role.strength} style={{ width: 6, height: 6, borderRadius: '50%', background: tint, flex: 'none' }} />
      <select
        aria-label={`${role.label} provider`}
        value={role.provider}
        onChange={(e) => {
          const p = e.target.value as Provider['id'];
          onChange(role.id, p, MODEL_OPTIONS[p][0]);
        }}
        style={selectStyle}
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <select
        aria-label={`${role.label} model`}
        value={role.model}
        onChange={(e) => onChange(role.id, role.provider, e.target.value)}
        style={selectStyle}
      >
        {(MODEL_OPTIONS[role.provider] ?? [role.model]).map((m) => (
          <option key={m} value={m}>
            {modelShort(m)}
          </option>
        ))}
        {!(MODEL_OPTIONS[role.provider] ?? []).includes(role.model) && <option value={role.model}>{modelShort(role.model)}</option>}
      </select>
    </div>
  );
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)', ...mono, fontSize: 11, letterSpacing: '.14em', color: 'var(--maestro)', background: 'var(--bg-deep)' }}>
      {children}
    </div>
  );
}

function ProviderRow({ p, first, onKey }: { p: Provider; first: boolean; onKey: (k: string) => void }) {
  const connected = p.connected || (p.local && true);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderTop: first ? 'none' : '1px solid var(--line-3)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#2E7D5B' : 'var(--line-6)', flex: 'none' }} />
      <span style={{ fontSize: 14, color: 'var(--text)', width: 78, flex: 'none' }}>
        {p.label}
        {p.local && <span style={{ fontSize: 11, color: 'var(--text-3)' }}> · local</span>}
      </span>
      <input
        type="password"
        defaultValue={p.key}
        onChange={(e) => onKey(e.target.value)}
        placeholder={p.local ? p.endpoint : `sk-…  paste ${p.label} key`}
        style={{ flex: 1, minWidth: 0, ...mono, fontSize: 11, color: 'var(--text-1)', background: 'var(--elev-3)', border: '1px solid var(--line-4)', borderRadius: 6, padding: '5px 9px', outline: 'none' }}
      />
    </div>
  );
}

function modelShort(m: string): string {
  return m.replace('claude-', '').replace('gemini-', '').replace(/-\d{8}$/, '').replace(/-4-\d$/, '');
}

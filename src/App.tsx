import { useEffect } from 'react';
import { useStore } from './state/store';
import { Titlebar } from './components/Titlebar';
import { Shelf } from './components/Shelf';
import { ScoreEditor } from './components/ScoreEditor';
import { DiffView } from './components/DiffView';
import { Maestro } from './components/Maestro';
import { Stage } from './components/Stage';
import { PerformanceMode } from './components/PerformanceMode';
import { ProvidersModal } from './components/ProvidersModal';
import { Arrangement } from './components/Arrangement';
import { PatchDesigner } from './components/PatchDesigner';
import { SampleFoundry } from './components/SampleFoundry';
import { NotationBridge } from './components/NotationBridge';
import { History, MergeConflictModal } from './components/History';
import { DirectiveForge } from './components/DirectiveForge';
import { Projects } from './components/Projects';
import { Prompter } from './components/Prompter';
import { AudioGate } from './components/AudioGate';
import { Settings } from './components/Settings';
import { Ports } from './components/Ports';

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable || node.classList?.contains('cm-content');
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const mode = useStore((s) => s.mode);
  const surface = useStore((s) => s.surface);
  const openSurface = useStore((s) => s.openSurface);
  const stagedEdit = useStore((s) => s.stagedEdit);
  const pendingMerge = useStore((s) => s.pendingMerge);
  const initAudio = useStore((s) => s.initAudio);

  // keep the <html data-theme> attribute in sync with the store
  useEffect(() => {
    setTheme(theme);
    // open the last project from local storage (spec §08)
    useStore.getState().hydrateFromStorage();
    // reflect the resolved reduced-motion pref onto <html> (spec §12.8)
    useStore.getState().applyMotion();
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotion = () => useStore.getState().applyMotion();
    mq?.addEventListener?.('change', onMotion);
    return () => mq?.removeEventListener?.('change', onMotion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load the engine + samples on the first user gesture (audio policy)
  useEffect(() => {
    let done = false;
    const kick = () => {
      if (done) return;
      done = true;
      initAudio();
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
    return () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, [initAudio]);

  // global keyboard — a keymap with no collisions (spec §02/§10). Space belongs
  // to the cursor now; the transport moved to F5. Every binding below is a play
  // key by IDE convention and can't be typed by accident.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const editable = isEditable(e.target);

      // Performance mode owns Esc (exit live); App owns everything else,
      // including the ONE transport binding (B-5: never two owners). Both halves
      // of this guard are load-bearing because window listeners fire in
      // REGISTRATION order and either order is reachable (RT-1):
      //   • booting straight into live — the child's effect registers first, so
      //     PerformanceMode has already preventDefault()ed *and* flipped mode to
      //     'studio' by the time this runs; only `defaultPrevented` still says so.
      //   • clicking `◰ live` at runtime — App registered first, so this runs
      //     while nothing is prevented yet; only `mode` still says live.
      // Missing the second case cleared the user's pins/arc on the way out.
      if (e.key === 'Escape' && (e.defaultPrevented || s.mode === 'performance')) return;

      // transport play/pause — the ACTIVE binding (spec §12.3). Browser tier
      // defaults to ⌘⇧⏎ (never browser-reserved); F5 is an opt-in alias. Works
      // even while typing.
      const isTransport =
        s.transportKey === 'f5'
          ? e.key === 'F5'
          : (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'Enter' || e.key === 'Return');
      if (isTransport) {
        e.preventDefault();
        s.togglePlay();
        return;
      }
      // ⌘. / ⌃. — PANIC, always available
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        s.panic();
        return;
      }
      // ⌘K — ask the Maestro inline (the editor handles selection-scoped ⌘K;
      // this is the fallback when focus is elsewhere)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('refrain:focus-maestro'));
        return;
      }
      // ⌘P — command palette (opens the Maestro's slash palette)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('refrain:command-palette'));
        return;
      }
      // ⌘O — open the project switcher (spec §08)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openSurface('projects');
        return;
      }
      // ⌘S — tag a named checkpoint (autosave is continuous · spec §08)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        s.saveCheckpoint();
        return;
      }
      // ⌥Z — rewind one commit (walk history back). Alt avoids the editor's ⌘Z.
      if (e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const head = s.history.find((c) => c.id === s.headId);
        if (head?.parentId) s.rewind(head.parentId);
        return;
      }
      // ⌥. — quiet / un-quiet the Prompter
      if (e.altKey && e.key === '.') {
        e.preventDefault();
        s.togglePrompter();
        return;
      }
      // Esc clears pins/arc back to whole-file even from the focused editor (§12.2)
      // — but only when there's nothing more local for Esc to do (no staged edit,
      // no open surface), so it never steals Esc from a completion/dialog.
      if (e.key === 'Escape' && !s.stagedEdit && !s.surface && (s.pins.length || s.arcSelection)) {
        s.clearPins();
        s.setArcSelection(null);
        return;
      }
      if (editable) return;

      if (s.stagedEdit && e.key === 'Enter') {
        e.preventDefault();
        s.acceptEdit();
      } else if (s.stagedEdit && (e.key === 'Backspace' || e.key === 'Escape')) {
        e.preventDefault();
        s.rejectEdit();
      } else if (e.key === 'Escape' && s.surface) {
        openSurface(null);
      } else if (e.key === 'Escape' && (s.pins.length || s.arcSelection)) {
        // Esc returns to whole-file context: clear all pins and any arc scope
        s.clearPins();
        s.setArcSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSurface]);

  if (mode === 'performance') {
    return <PerformanceMode />;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Titlebar />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '188px minmax(0,1fr) 312px', gridTemplateRows: 'minmax(0, 1fr)', minHeight: 0, overflow: 'hidden' }}>
        <Shelf />
        <div style={{ position: 'relative', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
            <ScoreEditor />
            {stagedEdit && <DiffView />}
          </div>
          <Prompter />
        </div>
        <Maestro />
      </div>
      <Stage />

      <AudioGate />
      {surface === 'providers' && <ProvidersModal />}
      {surface === 'arrangement' && <Arrangement />}
      {surface === 'patch' && <PatchDesigner />}
      {surface === 'foundry' && <SampleFoundry />}
      {surface === 'notation' && <NotationBridge />}
      {surface === 'history' && <History />}
      {surface === 'directives' && <DirectiveForge />}
      {surface === 'projects' && <Projects />}
      {surface === 'settings' && <Settings />}
      {surface === 'ports' && <Ports />}
      {/* voice-granular merge conflict card — shows over any surface (spec §12.6) */}
      {pendingMerge && <MergeConflictModal />}
    </div>
  );
}

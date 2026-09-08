// ---------------------------------------------------------------------------
// MIDI sync-out — the Cycle as sync master (spec §12.7). A SYSTEM BOUNDARY, like
// strudelEngine: it talks to the Web MIDI API. The rule is simple — the Cycle is
// always the master. Refrain SENDS 24-PPQN clock + start/stop/continue locked to
// `setcps`; it does not chase an external clock (one authority, no drift). PANIC
// propagates outward as all-notes-off on every channel so the emergency exit
// reaches the whole rig.
//
// OSC bundles and Ableton Link (also §12.7) need a bridge server / native peer —
// out of reach of the zero-install browser tier — so this honest build ships the
// MIDI half and the Ports panel labels the rest as desktop-shell tier.
//
// Import-safe: no Web MIDI access happens until enable() is called on a gesture.
// ---------------------------------------------------------------------------

import { engine } from './strudelEngine';
import type { MidiPort } from '../types';

// Web MIDI clock is 24 pulses per quarter-note; Refrain treats one cycle as four
// beats (bpm = cps·240), so a cycle carries 24·4 = 96 clock pulses.
const PULSES_PER_CYCLE = 96;
const CLOCK = 0xf8;
const START = 0xfa;
const CONTINUE = 0xfb;
const STOP = 0xfc;
const LS_KEY = 'refrain.midiPorts'; // { [id]: { enabled, latencyMs } }

type PortPref = { enabled: boolean; latencyMs: number };

function loadPrefs(): Record<string, PortPref> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PortPref>) : {};
  } catch {
    return {};
  }
}

class MidiSync {
  private access: any = null; // MIDIAccess
  private prefs: Record<string, PortPref> = loadPrefs();
  private raf = 0;
  private lastPulse = -1;
  private wasStarted = false;
  private enabling: Promise<boolean> | null = null;
  onChange: (() => void) | null = null;
  enabled = false; // MIDI access granted + loop running
  error: string | null = null;

  /** Is the Web MIDI API available at all (Chromium: yes; Safari/FF: no)? */
  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof (navigator as any).requestMIDIAccess === 'function';
  }

  /** Request MIDI access (no sysex) and begin driving the clock. Idempotent even
   *  under concurrent calls — the in-flight promise is shared. */
  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    if (this.enabling) return this.enabling;
    if (!this.supported) {
      this.error = 'Web MIDI is unavailable in this browser (Chromium only).';
      return false;
    }
    this.enabling = (async () => {
      try {
        this.access = await (navigator as any).requestMIDIAccess({ sysex: false });
        this.access.onstatechange = () => this.onChange?.();
        this.enabled = true;
        this.error = null;
        this.loop();
        this.onChange?.();
        return true;
      } catch (e: any) {
        this.error = e?.message ?? String(e);
        return false;
      } finally {
        this.enabling = null;
      }
    })();
    return this.enabling;
  }

  /** Stop driving the clock and cancel the loop (toggle off). */
  disable() {
    this.enabled = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.wasStarted = false;
    this.lastPulse = -1;
  }

  private outputs(): any[] {
    if (!this.access) return [];
    return Array.from(this.access.outputs.values());
  }

  /** Live outputs merged with saved enable/latency prefs (Ports panel). */
  ports(): MidiPort[] {
    return this.outputs().map((o) => {
      const pref = this.prefs[o.id] ?? { enabled: false, latencyMs: 0 };
      return { id: o.id, name: o.name || o.id, enabled: pref.enabled, latencyMs: pref.latencyMs };
    });
  }

  private enabledOutputs(): any[] {
    return this.outputs().filter((o) => this.prefs[o.id]?.enabled);
  }

  private savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* noop */
    }
  }

  setPortEnabled(id: string, on: boolean) {
    this.prefs[id] = { enabled: on, latencyMs: this.prefs[id]?.latencyMs ?? 0 };
    this.savePrefs();
    // if we just enabled a port while the transport is live, catch it up
    if (on && engine.started) this.send([START], id);
    this.onChange?.();
  }

  setPortLatency(id: string, ms: number) {
    this.prefs[id] = { enabled: this.prefs[id]?.enabled ?? false, latencyMs: ms };
    this.savePrefs();
    this.onChange?.();
  }

  private send(bytes: number[], onlyId?: string, aheadMs = 0) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    for (const o of this.enabledOutputs()) {
      if (onlyId && o.id !== onlyId) continue;
      // positive latency schedules ahead; negative is clamped (can't send in the
      // past) — the Ports panel notes this browser-tier limit. `aheadMs` spreads a
      // burst of clock pulses across the frame at the true pulse period.
      const at = now + aheadMs + Math.max(0, this.prefs[o.id]?.latencyMs ?? 0);
      try {
        o.send(bytes, at);
      } catch {
        /* a disconnected port — statechange will refresh the list */
      }
    }
  }

  /** Transport events, called from the store so external gear starts/stops with us. */
  transport(kind: 'start' | 'stop' | 'continue') {
    if (!this.enabled) return;
    this.send([kind === 'start' ? START : kind === 'continue' ? CONTINUE : STOP]);
    if (kind === 'stop') this.lastPulse = -1;
  }

  /** PANIC propagates outward: all-notes-off + reset-all-controllers, every
   *  channel. The clock keeps running — PANIC silences the rig, it doesn't stop
   *  external sequencers (spec §10: the safest exit still shows the clock alive). */
  allNotesOff() {
    if (!this.enabled) return;
    for (let ch = 0; ch < 16; ch++) {
      this.send([0xb0 + ch, 123, 0]); // all notes off
      this.send([0xb0 + ch, 121, 0]); // reset all controllers
    }
  }

  // Lock the outgoing clock to the real scheduler: derive absolute pulse count
  // from engine.now() and emit a clock byte for each whole pulse crossed. The
  // Cycle stays the single master — MIDI follows it, never the reverse.
  private loop = () => {
    if (this.enabled) {
      const started = engine.started;
      if (started && !this.wasStarted) {
        this.transport('start');
        this.lastPulse = Math.floor(engine.now() * PULSES_PER_CYCLE);
      } else if (!started && this.wasStarted) {
        this.transport('stop');
      }
      this.wasStarted = started;

      if (started) {
        const pulse = Math.floor(engine.now() * PULSES_PER_CYCLE);
        if (this.lastPulse < 0) this.lastPulse = pulse;
        // emit one clock per crossed pulse (cap the catch-up after a stall),
        // spread across the frame at the true pulse period so gear sees even 24-PPQN
        const gap = Math.min(PULSES_PER_CYCLE, pulse - this.lastPulse);
        if (gap > 0) {
          const periodMs = 1000 / (PULSES_PER_CYCLE * Math.max(0.05, engine.cps));
          for (let i = 0; i < gap; i++) this.send([CLOCK], undefined, i * periodMs);
        }
        this.lastPulse = pulse;
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}

export const midi = new MidiSync();

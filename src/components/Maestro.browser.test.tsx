import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Maestro } from './Maestro';
import { resetStore, state } from '../../tests/helpers/store';

// ---------------------------------------------------------------------------
// Browser tier (real Chromium via Playwright). Maestro is the chat surface that
// turns typed intent into routed store actions. We keep `playing` false (the
// default) so no store action ever calls the audio engine — hence no engine
// mock is needed. We drive real user input via userEvent (a real textarea +
// keyboard) and assert the resulting DOM and store state. The two interesting
// deterministic routes:
//   - "make it darker" → interpret() → directive `darker` → runDirective stages
//     an edit (no LLM) and emits a maestro diff message.
//   - "/" opens the DirectivePalette overlay (input.startsWith('/')), rendering
//     directive labels with no network or engine involvement.
// IDs are non-deterministic (Date.now()+counter), so we assert on text/shape,
// never on exact ids.
// ---------------------------------------------------------------------------

beforeEach(() => resetStore());

describe('Maestro (chat surface, real browser)', () => {
  it('renders the initial Maestro greeting message', () => {
    render(<Maestro />);
    // The seeded greeting introduces itself as "the Maestro". renderRich splits
    // the text across nodes and the header label "MAESTRO" also matches /Maestro/i,
    // so we assert at least one match and that the greeting copy is present.
    expect(screen.getAllByText(/Maestro/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/I'm the Maestro/)).toBeTruthy();
  });

  it('typing a directive phrase and pressing Enter routes to sendMaestro: user bubble + staged edit + diff message', async () => {
    const user = userEvent.setup();
    render(<Maestro />);

    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.click(box);
    await user.type(box, 'make it darker');
    await user.keyboard('{Enter}');

    // The user's text shows up as a bubble verbatim.
    await waitFor(() => expect(screen.getByText('make it darker')).toBeTruthy());

    // "darker" is a directive alias → runDirective stages an edit (no LLM path).
    await waitFor(() => expect(state().stagedEdit).not.toBeNull());

    // Pin the ACTUAL resolution: "darker" must map to the darker directive, whose
    // transform appends .lpf(600). Without this, a silent mis-route to any other
    // directive would still pass the "some edit exists" check above.
    expect(state().stagedEdit?.newCode).toContain('.lpf(600)');

    // A maestro diff message was appended (its editId points at the staged edit).
    const diff = state().messages.find((m) => m.role === 'maestro' && m.shape === 'diff');
    expect(diff).toBeTruthy();
    expect(diff?.editId).toBe(state().stagedEdit?.id);

    // Input is cleared after submit.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('typing "/" opens the DirectivePalette with directive labels visible', async () => {
    const user = userEvent.setup();
    render(<Maestro />);

    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.click(box);
    await user.type(box, '/');

    // The palette overlay lists directive labels; swing and crescendo exist.
    await waitFor(() => {
      expect(screen.getByText('swing')).toBeTruthy();
      expect(screen.getByText('crescendo')).toBeTruthy();
    });
    // Palette header is present too.
    expect(screen.getByText(/DIRECTIVES/)).toBeTruthy();
  });

  it('keeps the store out of playback (no engine touched): playing stays false', async () => {
    const user = userEvent.setup();
    render(<Maestro />);
    expect(state().playing).toBe(false);

    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    await act(async () => {
      await user.click(box);
      await user.type(box, 'make it darker');
      await user.keyboard('{Enter}');
    });

    await waitFor(() => expect(state().stagedEdit).not.toBeNull());
    expect(state().playing).toBe(false);
  });
});

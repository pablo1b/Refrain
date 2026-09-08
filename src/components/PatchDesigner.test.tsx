import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { PatchDesigner } from './PatchDesigner';
import { engine } from '../audio/strudelEngine';
import { useStore } from '../state/store';
import { resetStore } from '../../tests/helpers/store';

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

describe('PatchDesigner knob drag survives an untracked pointer (B-10)', () => {
  it('a knob pointerdown does not throw when capture fails', () => {
    const proto = Element.prototype as unknown as { setPointerCapture?: (id: number) => void };
    const original = proto.setPointerCapture;
    proto.setPointerCapture = () => {
      throw new DOMException('No active pointer with the given id is found.', 'NotFoundError');
    };

    const { container } = render(<PatchDesigner />);
    // the knobs are the only pointer-draggable elements in the surface
    const knob = container.querySelector('[style*="rotate"]') ?? container.querySelector('svg') ?? container.firstElementChild!;
    expect(() => fireEvent.pointerDown(knob, { pointerId: 999, clientY: 40 })).not.toThrow();

    if (original) proto.setPointerCapture = original;
    else delete proto.setPointerCapture;
  });
});

// The designer's whole point is staging a voice you can HEAR. It emitted
// `note("<Cm7 Abmaj7>")`, where the note value is the literal string "Cm7" —
// silent, with no error. Chord symbols reach pitch only via `.voicing()`.
describe('the staged patch voice can actually sound', () => {
  it('stages $warmpad through chord().voicing(), not a chord symbol in note()', () => {
    const { getByText } = render(<PatchDesigner />);
    fireEvent.click(getByText('stage as $warmpad'));

    const staged = useStore.getState().stagedEdit;
    expect(staged).toBeTruthy();
    expect(staged!.newCode).toContain('chord("<Cm7 Ab^7>").voicing()');
    expect(staged!.newCode).not.toMatch(/note\(\s*"<?[A-G][#b]?(m|maj|min|M|\^|dim|aug|sus|add|alt|[0-9])/);
  });

  it('shows the same chain it stages, so the diagram is not lying', () => {
    const { container } = render(<PatchDesigner />);
    expect(container.textContent).toContain('chord(x).voicing()');
  });
});

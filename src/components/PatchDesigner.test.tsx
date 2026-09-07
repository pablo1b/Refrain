import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { PatchDesigner } from './PatchDesigner';
import { engine } from '../audio/strudelEngine';
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

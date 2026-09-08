import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { DirectiveForge } from './DirectiveForge';
import { filterPalette } from './DirectivePalette';
import { engine } from '../audio/strudelEngine';
import { resetStore, state } from '../../tests/helpers/store';

const VERB = { label: 'Shimmer', chain: '.room(0.5).lpf(1200)', blurb: 'air', aliases: [] as string[] };

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

// B-9 is a VERIFICATION task: the Forge, the slash palette and the resolver must
// all read one field (state.customDirectives). These tests fail loudly if a
// second read source is ever reintroduced.
describe('Directive Forge reads the single source of truth (B-9)', () => {
  it('YOUR PACK counts and lists exactly the store customDirectives', () => {
    act(() => state().addCustomDirective(VERB));
    render(<DirectiveForge />);

    expect(screen.getByText(/YOUR PACK · 1/)).toBeTruthy();
    expect(screen.getByText('Shimmer')).toBeTruthy();
    expect(screen.getByText('.room(0.5).lpf(1200)')).toBeTruthy();
    expect(screen.queryByText(/No custom verbs yet/)).toBeNull();
  });

  it('the Forge list and the slash palette read the same list', () => {
    act(() => state().addCustomDirective(VERB));
    render(<DirectiveForge />);

    // id is derived deterministically from the label, so asserting it is safe
    expect(filterPalette('shimmer', state().customDirectives).map((i) => i.id)).toContain('u_shimmer');
    expect(screen.getByText('Shimmer')).toBeTruthy();
  });

  it('reflects a live store update without a remount', () => {
    const { container } = render(<DirectiveForge />);
    expect(container.textContent).toContain('YOUR PACK · 0');
    expect(screen.getByText(/No custom verbs yet/)).toBeTruthy();

    act(() => state().addCustomDirective(VERB));
    expect(container.textContent).toContain('YOUR PACK · 1');
  });

  it('removing a verb updates the list', () => {
    act(() => state().addCustomDirective(VERB));
    const { container } = render(<DirectiveForge />);
    act(() => state().removeCustomDirective('u_shimmer'));
    expect(container.textContent).toContain('YOUR PACK · 0');
  });
});

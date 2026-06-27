import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderRich } from './rich';

// Unit tier (happy-dom): renderRich is a pure inline markdown→React renderer.
// We render its nodes inside a <div> and assert the resulting DOM structure +
// text. highlightStrudel runs for real (pure rendering); a `code` span's
// textContent still equals the source code regardless of inner token spans.

function mount(text: string) {
  return render(<div>{renderRich(text)}</div>);
}

describe('renderRich', () => {
  it('passes plain text through as text', () => {
    const { container } = mount('just plain text');
    expect(container.textContent).toBe('just plain text');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
  });

  it('renders **bold** as a <strong> with the inner text', () => {
    const { container } = mount('**loud**');
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('loud');
  });

  it('renders *italic* as an <em> with the inner text', () => {
    const { container } = mount('*soft*');
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('soft');
  });

  it('renders `code` as a styled mono span containing the code text', () => {
    const { container } = mount('`s("bd")`');
    const strong = container.querySelector('strong');
    const em = container.querySelector('em');
    expect(strong).toBeNull();
    expect(em).toBeNull();
    // The code span is the first child span; its textContent is the raw code,
    // and it carries the mono font-family inline style.
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.getAttribute('style')).toContain('var(--font-mono)');
    expect(span!.textContent).toBe('s("bd")');
  });

  it('renders a mixed string with all four forms correctly and in order', () => {
    const { container } = mount('**a** plain *b* `c`');
    const strong = container.querySelector('strong');
    const em = container.querySelector('em');
    expect(strong!.textContent).toBe('a');
    expect(em!.textContent).toBe('b');
    // Full text reassembles in source order.
    expect(container.textContent).toBe('a plain b c');
    // The code piece is a mono span containing the code text.
    const mono = Array.from(container.querySelectorAll('span')).find((s) =>
      (s.getAttribute('style') || '').includes('var(--font-mono)'),
    );
    expect(mono).toBeTruthy();
    expect(mono!.textContent).toBe('c');
  });
});

import { render, screen } from '@testing-library/react';
import { AvatarStack, Button, ButtonLink, Chip, LogoMark, initials } from './index';

describe('initials', () => {
  it.each([
    ['Aarav Rao', 'AR'],
    ['meera', 'ME'],
    ['  Kabir   Singh Sethi ', 'KS'],
    ['', '?'],
    ['Test user (phone)', 'TU'],
    ['(phone)', '?'],
    ['A', 'A'],
    ['— Ishita', 'IS'],
    ['Élodie Ørsted', 'ÉØ'],
  ])('%j -> %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('components', () => {
  it('Button defaults to type=button', () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'button');
  });

  it('ButtonLink renders a link', () => {
    render(
      <ButtonLink href="/new" variant="primary">
        Start a room
      </ButtonLink>,
    );
    expect(screen.getByRole('link', { name: 'Start a room' })).toHaveAttribute('href', '/new');
  });

  it('Chip renders its text', () => {
    render(<Chip tone="accent">Live</Chip>);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('LogoMark is decorative without a title and labelled with one', () => {
    const { container, rerender } = render(<LogoMark />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<LogoMark title="PromptAlong" />);
    expect(screen.getByRole('img', { name: 'PromptAlong' })).toBeInTheDocument();
  });

  it('AvatarStack exposes every name to screen readers', () => {
    render(
      <AvatarStack
        people={[
          { id: 'a', name: 'Aarav', slot: 1 },
          { id: 'b', name: 'Meera Kapoor', slot: 2 },
        ]}
      />,
    );
    expect(screen.getByText('Aarav', { selector: '.sr-only' })).toBeInTheDocument();
    expect(screen.getByText('MK')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from './router';
import { applyTheme, systemTheme } from './theme';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('landing page', () => {
  it('shows the headline and the main actions', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Everyone prompts.One answer.',
    );
    for (const link of screen.getAllByRole('link', { name: 'Start a room' }))
      expect(link).toHaveAttribute('href', '/new');
    expect(screen.getByRole('link', { name: 'Try the live demo' })).toHaveAttribute(
      'href',
      '/demo',
    );
    expect(screen.getByRole('link', { name: 'Join with code' })).toBeInTheDocument();
  });

  it('lists the four differences, three use cases and a demo CTA', () => {
    renderAt('/');
    expect(screen.getByRole('region', { name: 'What makes it different' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Who it is for' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'See it in action' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(8);
    expect(screen.queryByText(/branch/iu)).toBeNull();
  });

  it('the home page keeps the credit line on screen; other pages have it in the footer', async () => {
    renderAt('/');
    const pinned = screen.getByTestId('made-by-pinned');
    expect(pinned).toHaveTextContent('Made with by Shubh and Sidak');
    // the heart takes the text colour (black on light, white on dark)
    expect(pinned).toHaveClass('text-text');
    expect(pinned.querySelector('path')?.getAttribute('fill')).toBe('currentColor');
    expect(screen.getAllByRole('img', { name: 'love' })).toHaveLength(1);
    renderAt('/about');
    expect((await screen.findAllByTestId('made-by')).length).toBeGreaterThan(0);
  });
});

describe('routes', () => {
  it('room link asks for a name first', async () => {
    localStorage.clear();
    renderAt('/r/K7QM2X');
    expect(await screen.findByRole('heading', { name: 'Join the room' })).toBeInTheDocument();
    expect(screen.getByText('Room K7Q-M2X')).toBeInTheDocument();
  });

  it('room route explains a bad code', async () => {
    renderAt('/r/nope');
    expect(
      await screen.findByRole('heading', { name: 'That code does not look right' }),
    ).toBeInTheDocument();
  });

  it('unknown paths show not found', () => {
    renderAt('/nowhere');
    expect(screen.getByRole('heading', { name: 'This page wandered off' })).toBeInTheDocument();
  });
});

describe('theme', () => {
  it('follows the system preference', () => {
    expect(systemTheme(() => ({ matches: true }))).toBe('dark');
    expect(systemTheme(() => ({ matches: false }))).toBe('light');
  });

  it('applies the theme to the root element', () => {
    const el = document.createElement('html');
    applyTheme('dark', el);
    expect(el.dataset.theme).toBe('dark');
  });
});

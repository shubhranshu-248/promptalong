import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../router';
import { cleanCodeChar } from './code';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('code characters', () => {
  it.each([
    ['k', 'K'],
    ['l', '1'],
    ['i', '1'],
    ['o', ''],
    ['0', ''],
    ['u', ''],
    ['-', ''],
  ])('%j -> %j', (input, expected) => {
    expect(cleanCodeChar(input)).toBe(expected);
  });
});

describe('lobby', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('needs a display name before creating a room', async () => {
    const router = renderAt('/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Create room' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add your name first');
    expect(router.state.location.pathname).toBe('/new');
  });

  it('creates a room and opens it with the share dialog', async () => {
    const router = renderAt('/new');
    fireEvent.change(await screen.findByLabelText('Your display name'), {
      target: { value: 'Aarav' },
    });
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Hackathon pitch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/r\/[1-9A-HJKMNP-TV-Z]{6}$/u);
    });
    expect(router.state.location.state).toEqual({
      create: { name: 'Hackathon pitch', sendPolicy: 'everyone' },
      share: true,
    });
    expect(localStorage.getItem('promptalong:name')).toBe('Aarav');
  });

  it('joins with a pasted code and rejects a bad one', async () => {
    localStorage.setItem('promptalong:name', 'Meera');
    const router = renderAt('/new');
    const first = await screen.findByTestId('code-0');
    fireEvent.change(first, { target: { value: 'K7Q' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Codes are 6 letters');
    fireEvent.paste(first, { clipboardData: { getData: () => 'k7q-m2x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/r/K7QM2X');
    });
  });
});

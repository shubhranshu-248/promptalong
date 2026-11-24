import { createBrowserRouter, type RouteObject } from 'react-router';
import { Landing } from './routes/Landing';
import { Loading } from './components/Loading';
import { NotFound } from './routes/NotFound';

/** The landing page is eager; every other screen is a lazy chunk. */
export const routes: RouteObject[] = [
  { path: '/', element: <Landing /> },
  {
    path: '/new',
    HydrateFallback: Loading,
    lazy: async () => ({ Component: (await import('./lobby/LobbyPage')).LobbyPage }),
  },
  {
    path: '/r/:code',
    HydrateFallback: Loading,
    lazy: async () => ({ Component: (await import('./room/RoomPage')).RoomPage }),
  },
  {
    path: '/demo',
    HydrateFallback: Loading,
    lazy: async () => ({ Component: (await import('./routes/Placeholder')).Demo }),
  },
  {
    path: '/about',
    HydrateFallback: Loading,
    lazy: async () => ({ Component: (await import('./routes/Placeholder')).About }),
  },
  { path: '*', element: <NotFound /> },
];

export const router = createBrowserRouter(routes);

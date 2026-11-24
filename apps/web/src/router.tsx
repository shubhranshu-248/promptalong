import { createBrowserRouter, type RouteObject } from 'react-router';
import { Landing } from './routes/Landing';
import { NotFound } from './routes/NotFound';

/** The landing page is eager; every other screen is a lazy chunk. */
export const routes: RouteObject[] = [
  { path: '/', element: <Landing /> },
  {
    path: '/new',
    lazy: async () => ({ Component: (await import('./routes/Placeholder')).NewRoom }),
  },
  {
    path: '/r/:code',
    lazy: async () => ({ Component: (await import('./routes/Placeholder')).Room }),
  },
  {
    path: '/demo',
    lazy: async () => ({ Component: (await import('./routes/Placeholder')).Demo }),
  },
  {
    path: '/about',
    lazy: async () => ({ Component: (await import('./routes/Placeholder')).About }),
  },
  { path: '*', element: <NotFound /> },
];

export const router = createBrowserRouter(routes);

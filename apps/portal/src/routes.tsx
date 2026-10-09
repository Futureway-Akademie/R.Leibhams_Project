import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/RequireAuth.js';
import { LOGIN_PATH } from './auth/redirect.js';
import { AppLayout } from './layout/AppLayout.js';
import { NAV_ITEMS } from './layout/navigation.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { PlaceholderPage } from './pages/PlaceholderPage.js';
import { AvailabilityPage } from './pages/availability/AvailabilityPage.js';
import { EditServicePage, NewServicePage } from './pages/services/ServiceFormPage.js';
import { ServiceListPage } from './pages/services/ServiceListPage.js';

/** Bereiche mit eigenen Seiten; die übrigen Einträge der Navigation sind noch Platzhalter. */
const IMPLEMENTED = new Set(['/', '/angebote', '/oeffnungszeiten']);

export const routes: RouteObject[] = [
  { path: LOGIN_PATH, element: <LoginPage /> },
  {
    // Alles außer dem Login verlangt eine Sitzung.
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          {
            path: '/angebote',
            children: [
              { index: true, element: <ServiceListPage /> },
              { path: 'neu', element: <NewServicePage /> },
              { path: ':serviceId', element: <EditServicePage /> },
            ],
          },
          { path: '/oeffnungszeiten', element: <AvailabilityPage /> },
          ...NAV_ITEMS.filter((item) => !IMPLEMENTED.has(item.path)).map((item) => ({
            path: item.path,
            element: <PlaceholderPage title={item.label} />,
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { PortalProvider } from './auth/hooks.js';
import { createPortal } from './auth/session.js';
import { routes } from './routes.js';
import './styles/portal.css';

const container = document.getElementById('root');
if (!container) throw new Error('Element #root fehlt');

const portal = createPortal();
const router = createBrowserRouter(routes);

createRoot(container).render(
  <StrictMode>
    <PortalProvider portal={portal}>
      <RouterProvider router={router} />
    </PortalProvider>
  </StrictMode>,
);

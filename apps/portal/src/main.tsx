import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { PortalProvider } from './auth/hooks.js';
import { createPortal } from './auth/session.js';
import { UpdateNotice } from './pwa/UpdateNotice.js';
import { startServiceWorker } from './pwa/service-worker.js';
import { routes } from './routes.js';
import './styles/portal.css';

const container = document.getElementById('root');
if (!container) throw new Error('Element #root fehlt');

const portal = createPortal();
const router = createBrowserRouter(routes);
const updates = startServiceWorker();

createRoot(container).render(
  <StrictMode>
    <PortalProvider portal={portal}>
      {updates && <UpdateNotice updates={updates} />}
      <RouterProvider router={router} />
    </PortalProvider>
  </StrictMode>,
);

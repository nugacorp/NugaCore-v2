import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {getAppScope, manifestPathForScope} from './lib/appScope';

// Selecciona la identidad de la PWA (Admin / Técnicos / Portal) según el scope
// del arranque (`?app=`), apuntando el <link rel="manifest"> al correcto antes
// de que el navegador ofrezca instalar.
try {
  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifestLink) manifestLink.href = manifestPathForScope(getAppScope());
} catch {
  /* Entornos sin DOM: no-op. */
}

// Quita el bust temporal `_nc` de la barra de direcciones tras un auto-reload
// por chunk faltante (el flag de sessionStorage lo limpia el primer import OK).
try {
  const url = new URL(window.location.href);
  if (url.searchParams.has('_nc')) {
    url.searchParams.delete('_nc');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  void navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      void registration.update();
    })
    .catch(() => undefined);
}

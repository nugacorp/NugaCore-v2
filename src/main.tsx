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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      void registration.update();
    })
    .catch(() => undefined);
}

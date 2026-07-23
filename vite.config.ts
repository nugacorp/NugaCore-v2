import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const wireguardMultitenant = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.WIREGUARD_MULTITENANT || '').trim().toLowerCase(),
  );
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __WIREGUARD_MULTITENANT__: JSON.stringify(wireguardMultitenant),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Separar vendor del código de la app: el vendor cambia poco y
          // queda cacheado entre deploys; la app invalida solo su chunk.
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-ui': ['lucide-react', 'motion'],
            'vendor-map': ['leaflet', 'react-leaflet'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // allowedHosts EXPLICITO desde env (lista separada por comas). Nunca se
      // usa wildcard: staging debe servir el build estatico (ver server.ts).
      ...(process.env.VITE_ALLOWED_HOSTS
        ? { allowedHosts: process.env.VITE_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean) }
        : {}),
    },
  };
});

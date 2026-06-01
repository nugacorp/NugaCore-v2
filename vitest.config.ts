import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Las pruebas de contrato comparten el store en memoria (singleton):
    // ejecutar en un solo hilo para evitar interferencias entre archivos.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: 'default',
  },
});

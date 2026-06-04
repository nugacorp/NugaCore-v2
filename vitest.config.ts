import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Fuerza el modo hermético por defecto (store en memoria, sin red ni
    // secretos) y replica el modo correcto para las suites reales DB/Auth.
    // Debe cargar ANTES que cualquier módulo del backend. Ver el archivo.
    setupFiles: ['tests/setup/test-env.ts'],
    // Las pruebas de contrato comparten el store en memoria (singleton):
    // ejecutar en un solo hilo para evitar interferencias entre archivos.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: 'default',
  },
});

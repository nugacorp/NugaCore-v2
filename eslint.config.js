// ====================================================================
// ESLint (Fase 3 production-ready). Configuración pragmática:
//  - typescript-eslint recommended (sin type-checking para mantener
//    el lint rápido; tsc ya cubre los errores de tipos).
//  - react-hooks: reglas de dependencias y orden de hooks.
//  - Sin reglas de estilo (formato lo decide el equipo, no el linter).
// ====================================================================
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.tmp_claude_debug.log'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Scripts de operaciones: corren en Node puro (ESM).
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    // Service worker público: corre en contexto Worker del navegador.
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        caches: 'readonly',
        fetch: 'readonly',
        self: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // TypeScript ya valida identificadores/globals; no-undef da falsos
      // positivos con console/process en archivos TS (recomendación oficial
      // de typescript-eslint).
      'no-undef': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Reglas nuevas de react-hooks v6: hallazgos reales pero su corrección
      // implica cambios de comportamiento (25 setState-en-effect, 5
      // componentes creados en render). Se degradan a warning y quedan como
      // backlog explícito de la auditoría (M2/M3).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  {
    rules: {
      // El proyecto arrastra `any` explícito en 16 archivos de src/
      // (auditoría M3); se reduce en la Fase 5. Warning, no error.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Los contratos de dominio usan interfaces vacías como marcadores.
      '@typescript-eslint/no-empty-object-type': 'warn',
      // Variables no usadas: error, pero permitiendo el prefijo _ convencional.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);

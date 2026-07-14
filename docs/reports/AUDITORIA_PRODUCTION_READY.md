# Auditoría Production-Ready — NugaCore-v2

Fecha: 2026-07-03 · Baseline: typecheck ✅ · build ✅ · tests 1769 ✅ (49 skipped)

## Veredicto general

El proyecto está en mejor estado que la mayoría: backend bien modularizado por dominios, auth JWT-only en producción con validación fatal de env, Docker multistage non-root con healthcheck, migraciones con guards de idempotencia, CI con typecheck+test+build. Los problemas reales son de **rigor de tipado, consistencia del frontend y tamaño de bundle**, no de arquitectura.

---

## Hallazgos por severidad

### 🔴 Alta

**A1. TypeScript sin `strict: true`** (`tsconfig.json`)
El mayor gap de calidad. Medido:
- `strictNullChecks` + los otros 5 flags estrictos → solo **8 errores** (triviales: 1 `req.log` posiblemente undefined, 7 propiedades duplicadas en spreads).
- `noImplicitAny` → **8.890 errores** (el grueso, requiere trabajo incremental).

Plan: activar ya todos los flags estrictos excepto `noImplicitAny`, corregir los 8 errores, y migrar `noImplicitAny` por carpetas después.

**A2. Bundle sin code splitting** (`src/App.tsx`, 1.342 líneas)
Cero `React.lazy`/`Suspense`. Todos los módulos (CRM, GIS, Billing, MikroTik, NOC…) se cargan en el chunk inicial → warning de chunks >500 kB. Un WISP operando desde campo con conectividad pobre lo sufre. Solución: lazy-load por módulo desde el switch de App.tsx.

**A3. 41 `fetch()` directos en componentes** (bypassean `src/lib/apiClient.ts`)
Sin backoff, sin manejo de errores centralizado, sin headers de auth consistentes. Migrar a `apiClient` módulo por módulo.

### 🟡 Media

**M1. Sin ESLint.** El script `lint` es solo `tsc --noEmit`. Falta linter real (eslint + typescript-eslint + react-hooks) para atrapar deps de hooks incorrectas, imports muertos, etc.

**M2. Componentes gigantes.** `CrmModule.tsx` (1.910), `App.tsx` (1.342), `RouterOsResourcesModule.tsx` (1.262), `FinanceOwnerModule.tsx` (1.098), `GisModule.tsx` (1.075). Dividir en subcomponentes + hooks extraídos.

**M3. `any` explícito en 16 archivos de `src/`** (backend: 0 ✅). Concentrado en los módulos grandes.

**M4. `express.json()` sin límite explícito** (`backend/app.ts:20`). El default de Express es 100 kb (aceptable), pero debe ser explícito y configurable.

**M5. `console.log/error` en frontend**: `App.tsx`, `LoginForm.tsx`, `NocOperationsPanel.tsx`. Reemplazar por logger de cliente o eliminar (LoginForm es especialmente sensible).

### 🟢 Baja

**B1. `package.json`**: name `react-example`, version `0.0.0`. Cosmético pero poco profesional para deploy.

**B2. CSP desactivada en helmet** (`http-security.ts`). Ya documentado como fase posterior; afinar cuando el SPA esté estable.

**B3. Migración `20260613120000` con solo 1 guard de idempotencia.** Revisar que re-ejecutar sea seguro.

**B4. `.tmp_claude_debug.log` (1,1 MB) en el directorio raíz.** No está trackeado en git (✅) pero conviene borrarlo.

**B5. Chunk warning configurable**: tras A2, ajustar `build.chunkSizeWarningLimit` o `manualChunks` para vendor.

### ✅ Lo que ya está bien (no tocar)

- Auth: JWT-only en prod, trusted headers solo dev, `validateEnvironment()` aborta si config insegura.
- Seguridad HTTP: helmet, CORS allowlist, rate limiting general + estricto en /api/auth, trust proxy 1 hop.
- Secretos: `.env` no trackeado, `.gitignore` correcto, redacción de secretos en logs.
- Docker: multistage, non-root, healthcheck, `--omit=dev`, log rotation en compose.
- Migraciones: timestamped, mayoría con guards IF NOT EXISTS/OR REPLACE.
- CI: typecheck + tests + build en cada push/PR a main.
- Backend: 0 `any`, dominios separados, request-id, security audit middleware.

---

## Plan de refactor propuesto (fases)

| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Flags estrictos de TS (sin noImplicitAny) + fix de 8 errores + `express.json` límite + clientLog + package.json | ✅ 2026-07-03 |
| 2 | Code splitting `React.lazy` (29 módulos) + manualChunks vendor. Chunk inicial 2.0 MB → 516 KB | ✅ 2026-07-03 |
| 3 | ESLint (flat config) + typescript-eslint + react-hooks; 92 errores corregidos (63 imports muertos, código muerto, escapes, TDZ); `npm run lint` real + paso en CI | ✅ 2026-07-03 |
| 4 | 40 de 41 `fetch()` migrados a `createAuthorizedApi` (apiClient); el restante es una descarga blob documentada. Helpers locales (fetchJson/fetchWithAuth/fetchIpamJson) reimplementados sobre el cliente central conservando firma | ✅ 2026-07-03 |
| 5 | `noImplicitAny` obligatorio en backend (`tsconfig.backend.json`, 0 errores, integrado a `npm run typecheck`); `catch (err: any)` eliminado en src (helper `getErrorMessage`); `any` explícito 40 → 24 | ✅ 2026-07-03 |
| 6 | CSP activa en producción (helmet, configurable `CSP_ENABLED` / `CSP_CONNECT_SRC`); migración B3 verificada idempotente (falsa alarma) | ✅ 2026-07-03 |

Verificación final (2026-07-03): eslint 0 errores · typecheck (raíz + backend estricto) 0 errores · build frontend y server OK · tests 1769 ✅ / 49 skipped — idéntico a la baseline, cero regresiones.

## Backlog restante (post-fases)

En orden de valor: (1) `noImplicitAny` en `src/` (~8.9k errores, migrar carpeta por carpeta y luego subir el flag al tsconfig raíz); (2) dividir componentes gigantes — CrmModule 1.9k, App.tsx 1.3k, RouterOsResourcesModule 1.2k — extrayendo subcomponentes y hooks; (3) los 104 warnings de ESLint (25 `set-state-in-effect`, 5 `static-components`, 24 `no-explicit-any` en props/payloads que requieren tipar los contratos App↔módulos); (4) considerar quitar `'unsafe-inline'` de style-src cuando se eliminen los 4 archivos con `style={{}}`.

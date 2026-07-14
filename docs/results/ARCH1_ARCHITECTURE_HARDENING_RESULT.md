# ARCH-1 — Architecture Hardening & Technical Debt Elimination — Result

Fecha: 2026-06-24
Rama: `main`
Resultado final: ✅ COMPLETADO (hardening sin cambio de comportamiento)

## Alcance y principio rector

ARCH-1 es una fase de **fortalecimiento de arquitectura**, no de funcionalidad.
No se desarrollaron features, módulos, pantallas, ni se cambió UX/branding/
colores. No se tocó RouterOS, Worker Live, MikroTik ni CHR. La restricción
dominante (FASE M/N) fue: **no romper contratos ni tests**. Como los componentes
"gigantes" prioritarios están protegidos por tests de aserción de strings
(`readFileSync().toContain(...)` — App 18, Sidebar 10, Client360 5, CrmModule 5,
Dashboard 4), dividirlos habría roto esos tests; por eso la división de
componentes se entrega como **backlog priorizado documentado**, y en código solo
se ejecutaron refactors *additive*/por *delegación* 100% verificables.

## Lo ejecutado en código (seguro y verificado)

1. **FASE C — Extracción de utilidad común:** se creó `backend/common/time.ts`
   con `nowIso()` y se reemplazaron **12** definiciones locales idénticas en:
   automation/rules, automation/service, manual-safe-mode/mappers,
   mikrotik/provisioning/store, mikrotik/worker/worker, payments/service,
   provisioning/service, router-enrollment/repository, router-enrollment/service,
   safe-command-queue/mappers, suspension/engine-store, wireguard/service.
   Implementación idéntica → sin cambio de comportamiento.

2. **FASE F — Centralización de feature flags:** se añadió `useDbWireguard()` a
   `backend/config/feature-flags.ts` (fuente única) y el servicio WireGuard
   ahora **delega** en ese helper en vez de releer `process.env`. Comportamiento
   idéntico. Documentado en `docs/FEATURE_FLAGS.md`.

## Documentación entregada

- `docs/ARCHITECTURE_AUDIT.md` — inventario completo (FASE A).
- `docs/ARCHITECTURE_OVERVIEW.md` — dominios, dependencias, providers, RBAC, flags (FASE K).
- `docs/FEATURE_FLAGS.md` — fuente de verdad de flags (FASE F).
- `docs/TECHNICAL_DEBT.md` — sección ARCH-1 con clasificación Critical/High/Medium/Low + esfuerzo (FASE L).
- `docs/ARCH1_ARCHITECTURE_HARDENING_RESULT.md` — este documento (FASE O).
- Actualizados: `ROADMAP.md`, `docs/PROJECT_STATUS_CURRENT.md`, `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md`.

## Hallazgos clave de la auditoría

- Arquitectura ya madura: capas `common/`, `core/` (repos genéricos),
  `config/feature-flags`, providers con interfaz en IPAM y RouterOS read-only,
  RBAC backend sin duplicación (`rbac.ts` + `action-permissions.ts`).
- 0 TODO/FIXME accionables. Sin ciclos de importación que rompan el build.
- Deuda raíz: store en memoria (`state/store.ts`) y lógica de negocio en rutas
  (TD-01/TD-02); God Components frontend (App, CrmModule, etc.).
- Duplicación real eliminada: `nowIso` ×12 y lectura local del flag WireGuard.

## Backlog priorizado (no ejecutado en ARCH-1, ver TECHNICAL_DEBT.md §0)

- C-1/C-2: capa repository + DB; sacar negocio de las rutas (esfuerzo L).
- H-1/H-2/H-3: dividir App.tsx y CrmModule preservando aserciones de tests;
  lazy loading + code splitting del bundle (esfuerzo M).
- M-3/M-4: dividir el resto de God Components; activar `noUnusedLocals` (S/M).
- L-1..L-3: unificar `nowStamp`, formato de moneda y forma de providers (S).

## Validación (FASE N)

- `npm run typecheck`: PASS (`tsc --noEmit`)
- `npm test`: PASS (`137 passed | 8 skipped` test files; `1712 passed | 49 skipped` tests)
- `npm run build`: PASS (`vite build` + `esbuild server.ts`)

## Contratos (FASE M)

Sin cambios en endpoints, payloads, RBAC, feature flags (solo additive) ni
tests. Ninguna protección de seguridad se redujo.

## Qué debe validar Hermes

1. `git diff` confirma que los cambios de código son solo: `backend/common/time.ts`
   (nuevo), 12 imports de `nowIso`, y la delegación del flag WireGuard.
2. `npm run typecheck && npm test && npm run build` en verde (sin cambios de conteo de tests: 1712).
3. Los docs nuevos reflejan la arquitectura real (dominios, providers, RBAC, flags).
4. No hay cambios de UX/branding/colores ni de comportamiento funcional; no se
   tocó RouterOS/Worker Live/MikroTik/CHR; no se activó ningún flag (`USE_DB_*`).

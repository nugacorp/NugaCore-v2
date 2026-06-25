# NugaCore — Architecture Audit (ARCH-1)

> Fecha: 2026-06-24
> Alcance: inventario completo del sistema previo a integraciones reales.
> Esta auditoría **no cambia comportamiento**: documenta el estado actual y
> alimenta `TECHNICAL_DEBT.md` y `ARCHITECTURE_OVERVIEW.md`.

## 1. Inventario cuantitativo

| Métrica | Valor |
| --- | --- |
| Dominios backend | 33 |
| Archivos `.ts` backend | 184 |
| Archivos frontend (`.ts`/`.tsx`) | 63 |
| Archivos de test | 145 |
| Tests | 1712 passed / 49 skipped |
| LOC backend (aprox.) | 25.7k |
| LOC frontend (aprox.) | 23.0k |
| TODO / FIXME / HACK reales | 0 accionables (5 coincidencias = palabra "TODO" en español) |

## 2. Backend

### Capas comunes (`backend/common`, `backend/core`, `backend/config`)
- `common/`: `errors.ts`, `rbac.ts`, `action-permissions.ts`, `auth-context.ts`,
  `logger.ts`, `metrics.ts`, `api-response.ts`, `validators.ts`,
  `request-context.ts`, `secret-redaction.ts`, `security/`, `time.ts` (ARCH-1).
- `core/`: `repository.ts` (interfaz), `in-memory-repository.ts`, `service.ts`,
  `index.ts` — base genérica de repositorios.
- `config/`: `env.ts` (validación fail-fast en prod), `feature-flags.ts`
  (fuente única de flags), `supabase`.
- `state/store.ts` (889 líneas): store en memoria (datos semilla + IDs +
  bitácoras). **Deuda raíz** (ver TD-01).

### Dominios (33)
auth, automation, automations, billing, coverage, customers, dashboard, gis,
health, inventory, inventory-sync, ipam, manual-safe-mode, mikrotik, network,
noc, noc-telemetry, payments, plans, provisioning, reports, router-enrollment,
router-template-parameters, routeros-readonly, routeros-resources,
routeros-templates, safe-command-queue, security, service-status, suspension,
system, tickets, wireguard.

Patrón típico por dominio: `routes.ts` + `service.ts` + `store.ts`/`repository.ts`
+ `types.ts` (+ `mappers.ts`, `providers/` donde aplica). Rutas registradas en
`backend/register-routes.ts`.

### Archivos backend > 600 líneas (candidatos a división)
| Archivo | Líneas |
| --- | --- |
| `domains/inventory/repository.ts` | 967 |
| `state/store.ts` | 889 |
| `domains/routeros-templates/generator.ts` | 867 |
| `domains/mikrotik/routes.ts` | 747 |
| `domains/router-enrollment/service.ts` | 667 |
| `domains/tickets/routes.ts` | 647 |

## 3. Frontend

- Entrada: `src/App.tsx` (1337 líneas, **God Container** — concentra estado,
  handlers, fetching y render por tab).
- Componentes en `src/components/`, módulos especializados en `src/modules/*`.
- RBAC visual + helpers en `src/lib/` (rbac, *Rbac.ts por dominio, supabase).

### Componentes > 600 líneas (FASE B — candidatos a división)
| Componente | Líneas | ¿Tests leen el archivo como string? |
| --- | --- | --- |
| `components/CrmModule.tsx` | 1910 | sí (5) |
| `App.tsx` | 1337 | sí (18) |
| `components/RouterOsResourcesModule.tsx` | 1262 | — |
| `components/FinanceOwnerModule.tsx` | 1098 | — |
| `components/GisModule.tsx` | 1075 | — |
| `components/RouterOnboardingWizard.tsx` | 926 | — |
| `components/BillingModule.tsx` | 886 | — |
| `components/RouterEnrollmentWizard.tsx` | 866 | — |
| `components/RouterOsTemplatesModule.tsx` | 865 | — |
| `components/NetworkModule.tsx` | 825 | — |
| `components/NocOperationsPanel.tsx` | 771 | — |
| `components/SupportModule.tsx` | 705 | — |
| `components/LandingPage.tsx` | 679 | — |

> **Riesgo de FASE B:** los componentes prioritarios (App, Sidebar, Client360,
> Dashboard, CrmModule) están protegidos por tests de aserción de strings
> (`readFileSync().toContain(...)`): App 18 archivos, Sidebar 10, Client360 5,
> CrmModule 5, Dashboard 4. Dividirlos rompería esos tests, lo que **viola FASE
> M/N** (no romper tests/contratos). Se documenta el plan de división como
> backlog priorizado en `TECHNICAL_DEBT.md`; en ARCH-1 no se ejecuta para no
> romper el contrato de tests.

## 4. Providers

Tres dominios tienen capa `providers/`:
- `ipam/providers`: `provider-interface.ts`, `mock-provider.ts`,
  `routeros-provider.ts`, `fallback.ts`, `index.ts`.
- `routeros-readonly/providers`: misma forma (interface + mock + routeros +
  fallback + index + routeros-client).
- `payments/providers`: `manual.provider.ts`, `mercadopago.provider.ts`,
  `openpay.provider.ts`, `index.ts` (forma distinta: por pasarela, no mock/real).

**Hallazgo (FASE D):** IPAM y RouterOS read-only ya comparten patrón
(interface + mock + real + fallback + index selector por entorno). Payments usa
un patrón por pasarela. Automation/Provisioning/Inventory/Billing/NOC usan
service+store, no "provider" (no consumen sistemas externos todavía). Unificar
una única interfaz literal para dominios que no tienen integración externa sería
forzado; la recomendación es estandarizar **solo** los dominios con backend
externo (IPAM, RouterOS, Payments) sobre la firma `interface + mock + real +
fallback + index`. Ver `ARCHITECTURE_OVERVIEW.md`.

## 5. RBAC

Fuente de verdad backend (no duplicada):
- `backend/common/rbac.ts`: roles (`AppRole`), `READ_ROLES`, `requireRoles`,
  `requireAction`, `normalizeRole`.
- `backend/common/action-permissions.ts`: matriz de permisos de acción
  (7 claves: reports.*, automation.*, security.*).
- `src/lib/rbac.ts`: **espejo de visibilidad** en el frontend (`AppTab`,
  `roleTabs`, `canAccessTab`, `isVisibleInSidebar`, `MODULE_LABELS`).

**Hallazgo (FASE E):** no hay matrices RBAC duplicadas en backend. El frontend
mantiene su propio mapa de *visibilidad* (intencional: gating visual ≠ gating de
escritura, que vive en el backend). No se detectaron permisos muertos ni roles
sin uso: los 6 roles (`super admin`, `administrador`, `cobranza`, `tecnico`,
`soporte`, `solo lectura`) se usan en `permissionMatrix` y/o `roleTabs`. Cada
tab en `AppTab` tiene al menos un rol y un render en `App.tsx`.

## 6. Feature Flags

Centralizadas en `backend/config/feature-flags.ts` (15 dominios + WireGuard +
Router Enrollment). Documentadas en `FEATURE_FLAGS.md` (ARCH-1). Default `false`.
Tras ARCH-1 el servicio WireGuard delega en el helper central (antes releía
`process.env` localmente).

## 7. Duplicidades detectadas

| Duplicidad | Estado |
| --- | --- |
| `const nowIso = () => new Date().toISOString()` ×12 dominios | ✅ Resuelto en ARCH-1 → `backend/common/time.ts` |
| Lectura local de `USE_DB_WIREGUARD` vs flag central | ✅ Resuelto en ARCH-1 (delegación) |
| `nowStamp` (formato `YYYY-MM-DD HH:mm`) ×varios | Pendiente (no idéntico; varía substring). Backlog. |
| Helpers de formato de moneda en frontend | Pendiente (varía por módulo). Backlog. |

## 8. Dependencias circulares

No se detectaron ciclos de importación que rompan el build (`tsc --noEmit`
limpio y `esbuild` bundle OK). El acoplamiento más notable es `state/store.ts`
como hub compartido (esperado en arquitectura store-first; se resolverá con la
capa repository, TD-01/TD-02).

## 9. Código muerto / imports innecesarios

`tsc` no está configurado con `noUnusedLocals`. No se hallaron exports
huérfanos evidentes en la revisión manual; el riesgo de eliminar "muerto"
usado dinámicamente (p. ej. tabs por string) supera el beneficio en esta fase.
Recomendación: activar `noUnusedLocals`/`noUnusedParameters` en una fase futura
y limpiar lo que marque (backlog, esfuerzo S).

## 10. Seguridad (resumen, ver SECURITY_AUDIT.md)

- Identidad por JWT Supabase verificado; `AUTH_TRUST_HEADERS` solo dev/test con
  fail-fast en prod (`config/env.ts`).
- Redacción de secretos (`common/secret-redaction.ts`,
  `common/security/sanitize-sensitive-data.ts`); cifrado en `services/crypto.ts`.
- Static-safety tests garantizan que automation/provisioning/routeros-readonly
  no contienen primitivas de ejecución/escritura live.
- ARCH-1 no reduce ninguna protección: los refactors son additive/delegación.

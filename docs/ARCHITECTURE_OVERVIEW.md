# NugaCore — Architecture Overview (ARCH-1)

> Fecha: 2026-06-24
> Vista de alto nivel por dominios, dependencias y patrones. Complementa
> `ARCHITECTURE_AUDIT.md` (inventario) y `SYSTEM_ARCHITECTURE.md` (histórico).

## 1. Topología general

```
                         ┌──────────────────────────┐
   Browser (React/Vite)  │  src/App.tsx (container)  │
   ─────────────────────▶│  components/ + modules/   │
                         │  lib/rbac.ts (visibilidad)│
                         └────────────┬─────────────┘
                                      │ fetch /api/* (JWT Supabase)
                                      ▼
                         ┌──────────────────────────┐
   Express (server.ts)   │ register-routes.ts        │
   ─────────────────────▶│ common/{auth,rbac,errors} │  ← middleware transversal
                         │ domains/<dominio>/routes  │
                         └────────────┬─────────────┘
                                      │ service → store|repository
                                      ▼
                ┌─────────────────────────────────────────┐
                │ state/store.ts (memoria)  |  Supabase DB │  ← seleccionado por
                │                            (feature flag)│     feature-flags.ts
                └─────────────────────────────────────────┘
```

## 2. Patrón por dominio

```
domains/<dominio>/
  routes.ts      → HTTP + RBAC (requireRoles / requireAction) + validación
  service.ts     → reglas de negocio (puro, testeable)
  store.ts       → estado en memoria  ──┐  selección por
  repository.ts  → persistencia DB     ─┘  config/feature-flags.ts
  types.ts       → contratos del dominio
  mappers.ts     → DTO ↔ modelo (opcional)
  providers/     → integración externa (opcional: ipam, routeros, payments)
  audit.ts       → bitácora descriptiva (automation, provisioning)
```

Transversales: `common/errors` (AppError + asyncHandler + errorHandler),
`common/rbac` (+ `action-permissions`), `common/logger`, `common/api-response`,
`common/secret-redaction`, `common/time` (ARCH-1), `core/*` (repos genéricos).

## 3. Mapa de dominios y dependencias

| Dominio | Rol | Depende de | Notas |
| --- | --- | --- | --- |
| **auth** | Identidad/JWT | Supabase, common/auth-context | Verifica rol; no confía en headers en prod |
| **customers** (CRM) | Clientes/leads | store, plans | Alta, conversión de lead |
| **plans** | Catálogo de planes | store | |
| **billing** | Facturación/cobranza | store/repo, customers | SSOT de cobranza (`USE_DB_BILLING`) |
| **payments** | Portal de pago | providers (manual/MP/openpay) | Reactivación por pago |
| **suspension** | Cortes/reactivación | store, billing | Dry-run/lógico, no toca routers |
| **service-status** | Estado oficial de servicio | store, suspension | SSOT de `serviceStatus` (KPI Suspendidos) |
| **provisioning** | Acciones operativas (dry-run) | store, service-status | Estados PENDING→APPROVED; `decisionSource` |
| **automation** | Decision Engine (dry-run) | store, audit | 16 eventos → 9 decisiones + executionPreview; **no ejecuta** |
| **inventory** / inventory-sync | ERP de equipo | repository, store | |
| **ipam** | Direccionamiento IP | providers (mock/routeros) | Solo lectura/asignación lógica |
| **network** / gis / coverage | Red WISP/FTTH/mapa | store | |
| **noc** / noc-telemetry | Monitoreo/alertas | store | Read-only |
| **mikrotik** / routeros-readonly / routeros-resources / routeros-templates | RouterOS | providers, generators | Lectura + generación; **sin write live (gated)** |
| **router-enrollment** / wireguard | Onboarding + VPN | repository, crypto | Flags propios |
| **dashboard** | KPIs ejecutivos | system/metrics + summaries de dominios | Lee, no muta |
| **system** | Métricas SSOT + consistencia | todos (read) | `systemMetrics` |
| **reports** / security | Export / auditoría | action-permissions | |
| **tickets** (support) | OT/soporte | store | |

### Flujo de decisión (PROD-7/8)
```
Evento de dominio ─▶ automation (decide, dry-run) ─▶ decisión + executionPreview
                                                       │ (propuesta)
                                                       ▼
                              provisioning (acción dry-run con decisionSource)
                                                       │
                                                       ▼
                              service-status / dashboard (reflejan, no ejecutan)
```
Ningún paso ejecuta cambios reales en routers/Worker Live (gated).

## 4. Providers (integración externa)

Patrón estándar (IPAM, RouterOS read-only):
```
providers/
  provider-interface.ts   → contrato
  mock-provider.ts        → implementación segura por defecto
  routeros-provider.ts    → implementación real (read-only)
  fallback.ts             → degradación segura
  index.ts                → selector por entorno
```
Payments usa una variante por pasarela (`manual`, `mercadopago`, `openpay`)
detrás de `index.ts`. Recomendación ARCH-1: nuevos dominios con backend externo
deben adoptar la firma estándar (interface + mock + real + fallback + index).

## 5. RBAC (fuente de verdad)

- Backend (autoritativo): `common/rbac.ts` (roles + `requireRoles`/`requireAction`)
  + `common/action-permissions.ts` (matriz de permisos de acción).
- Frontend (visibilidad): `src/lib/rbac.ts` (`roleTabs`, `canAccessTab`,
  `isVisibleInSidebar`). Es **espejo de visibilidad**, no de autorización: las
  escrituras siempre se gatean en el backend.

## 6. Feature Flags

Única fuente: `backend/config/feature-flags.ts`. Documentadas en
`FEATURE_FLAGS.md`. Default `false` (store en memoria, sin live).

## 7. Principios de evolución

1. `routes → service → store|repository` por dominio (no lógica de negocio en rutas).
2. Selección store/DB por feature flag, sin "big bang".
3. Decisión (automation) y ejecución (futuro Worker) **separadas**; hoy todo dry-run.
4. Secretos cifrados y redactados; identidad por JWT verificado.
5. Contratos de API y RBAC estables; los tests de contrato los protegen.

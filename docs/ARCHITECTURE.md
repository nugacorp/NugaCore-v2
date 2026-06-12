# NugaCore — Arquitectura del Sistema (Referencia Rápida)

> Última actualización: 2026-06-12
> Estado de implementación: **Fases 4.1–4.7 completadas. Fase 4.8 planificada.**
> Documento detallado: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)

---

## Modelo de despliegue actual

Un único proceso Node.js (Express + Vite) en puerto 3000 sirve API y frontend desde el mismo origen.

```
Navegador (React SPA)
        │
        ▼
Proceso Node.js (puerto 3000)
  ├─ attachAuthContext     ← JWT Supabase / trusted-headers dev
  ├─ attachSecurityAudit   ← bitácora HTTP → store
  ├─ registerRoutes()      ← 15 dominios (ver sección 3)
  ├─ errorHandler
  └─ Vite middleware (dev) / dist/ estáticos (prod)
        │
        ├─ state/store.ts  ← DATOS EN MEMORIA (mock, se migra por dominio)
        ├─ backend/services/supabase-admin.ts
        ├─ backend/services/crypto.ts  (AES-256-GCM)
        └─ backend/services/gemini.ts  (IA MikroTik)
```

---

## Modelo de despliegue objetivo (Fase 4.8+)

```
Navegador
  │  Supabase Auth (JWT)
  ▼
Reverse proxy (Coolify / Traefik)
  │
  ▼
Express API (contenedor)
  ├─ auth(JWT real) → RBAC → service → repository
  ├─ Supabase / PostgreSQL   ← fuente de verdad
  └─ Worker MikroTik         ← cola de comandos, proceso separado
        │
        ▼
     Routers MikroTik en sitio
```

---

## Dominios implementados

| Dominio | Ruta backend | Feature flag | Estado |
|---------|-------------|--------------|--------|
| IAM / Auth | `domains/iam/` | — | ✅ Fase 1 |
| Clientes | `domains/clients/` | `USE_DB_CLIENTS` | ✅ Fase 2 |
| Planes | `domains/plans/` | `USE_DB_PLANS` | ✅ Fase 3 |
| Billing | `domains/billing/` | `USE_DB_BILLING` | ✅ Fase 4.1–4.4 |
| Suspensión | `domains/suspension/` | `USE_DB_SUSPENSION` | ✅ Fase 4.5 |
| MikroTik | `domains/mikrotik/` | `USE_DB_MIKROTIK` | ✅ Fase 4.6 |
| WireGuard Manager | `domains/wireguard/` | `USE_DB_WIREGUARD` | ✅ Fase 4.6 |
| RouterOS Templates | `domains/routeros-templates/` | — | ✅ Fase 4.6 |
| Router Enrollment | `domains/router-enrollment/` | `USE_DB_ROUTER_ENROLLMENT` | ✅ Fase 4.7 |
| **Payment Engine** | `domains/payment-engine/` | `USE_DB_PAYMENT_ENGINE` | 🔲 Fase 4.8 |
| Torres | `domains/towers/` | — | 🔲 Fase 6 |
| Inventario | `domains/inventory/` | — | 🔲 Fase 7 |
| Tickets | `domains/tickets/` | — | 🔲 Fase 9 |
| Órdenes de trabajo | `domains/work-orders/` | — | 🔲 Fase 10 |

---

## Patrón por dominio

```
backend/domains/<dominio>/
  types.ts        ← interfaces + tipos (Record, View, Input, enums)
  repository.ts   ← Store mock + Supabase; alternado por feature flag
  service.ts      ← reglas de negocio, sin lógica HTTP
  routes.ts       ← Express Router + RBAC; delega a service
  mappers.ts      ← snake_case (DB) ↔ camelCase (TS)
```

La lógica nunca sube a `routes.ts`; los efectos secundarios externos (WireGuard, MikroTik) se invocan desde `service.ts` vía interfaces desacopladas.

---

## Dominios de Fase 4.6–4.7 en detalle

### WireGuard Manager

```
wgService.getPeerConfigForRouter(routerId, serverId, actorId)
  ├─ busca peer activo existente → reutiliza (AES-256-GCM para re-descarga)
  └─ crea nuevo peer → IPAM asigna IP en wgVpnCidr

wgService.revokePeer(peerId)         ← revocación; libera IP del pool
wgService.listPeers({ routerId, serverId, status })
wgService.rotateKeys(peerId)
```

IPAM mantiene un bitset de IPs asignadas dentro de `wgVpnCidr`. Garantía: no se asigna la misma IP dos veces mientras haya un peer activo.

### RouterOS Templates Library

```
generateFromTemplate({
  templateId: 'router_base_wireguard',
  ...wgParams          ← publicKey, presharedKey, allowedIPs, endpoint, routerosVersion
})
```

13 plantillas en 8 categorías. Validación semántica antes de emitir el script. El header del script contiene `# RouterOS  : v${routerosVersion}+` — permite detectar incompatibilidades.

### Router Enrollment

```
POST /api/router-enrollment          ← start (RBAC: SA/Admin/Técnico)
GET  /api/router-enrollment          ← list
GET  /api/router-enrollment/:id      ← getById
GET  /api/router-enrollment/:id/download  ← descarga script (re-descargable)
POST /api/router-enrollment/:id/check-online  ← polling estado
POST /api/router-enrollment/:id/revoke        ← (RBAC: SA/Admin)
```

Estado del enrollment: `draft → script_generated → script_downloaded → waiting_for_router → online → failed → revoked`

El script `.rsc` **nunca se persiste**. Solo `scriptHash` (SHA-256, 32 chars) queda en DB.

Garantías post-hotfix (Fase 4.7):
- `store.MIKROTIK_ROUTERS.push()` solo ocurre si `buildScript()` termina exitosamente → no hay routers huérfanos
- Si `buildScript()` falla y ya se creó un peer WG, se intenta rollback best-effort
- `routerosVersion` persiste en `RouterEnrollmentRecord` → `download()` regenera con la versión correcta

---

## Payment Engine — Arquitectura prevista (Fase 4.8)

> No implementado. Este diseño es orientativo para la planificación de Fase 4.8.

```
Cliente final
  │  POST /api/payment-engine/orders     ← crea orden de pago
  ▼
Payment Engine Service
  ├─ PaymentProviderInterface
  │   ├─ ManualProvider
  │   ├─ MercadoPagoProvider
  │   ├─ OpenPayProvider
  │   └─ SpeiProvider (futuro)
  │
  ├─ POST /api/payment-engine/webhooks/:provider  ← webhook externo
  │    └─ validación de firma (HMAC-SHA256 / x-signature)
  │
  └─ BillingIntegrationService
       ├─ payment.status = confirmed
       ├─ invoice.status = paid
       ├─ subscription.status = active
       ├─ customer.status = active
       └─ MikrotikReactivationService → cola de comandos
```

### Nuevas tablas previstas

```
payment_orders
  id, customer_id, invoice_id, provider, amount, currency,
  status (pending/confirmed/failed/refunded), external_ref,
  created_at, updated_at

payment_events
  id, order_id, provider, event_type, raw_payload,
  signature_valid, processed_at, created_at

mikrotik_actions
  id, customer_id, router_id, action_type (disable/enable),
  triggered_by (webhook/manual), status, executed_at,
  result_payload, created_at
```

### RBAC previsto

| Acción | Roles permitidos |
|--------|-----------------|
| Crear orden de pago | Super Admin · Administrador · Cobranza · **Cliente** |
| Ver propia orden | **Cliente** |
| Confirmar pago manual | Super Admin · Administrador · Cobranza |
| Recibir webhook | Sistema (sin auth de usuario) |
| Ejecutar reactivación MikroTik | Sistema (automático vía webhook) |
| Ver log de acciones MikroTik | Super Admin · Administrador · Técnico |

---

## Seguridad transversal

| Mecanismo | Estado |
|-----------|--------|
| AES-256-GCM para credenciales MikroTik | ✅ Activo (Fase 4.6) |
| AES-256-GCM para claves WireGuard en reposo | ✅ Activo (Fase 4.6) |
| RLS deny-by-default en Supabase | ✅ Activo (Fase 4.1) |
| RBAC por endpoint (`requireRoles` / `requireAction`) | ✅ Activo (Fase 1) |
| Scripts RouterOS nunca persistidos | ✅ Activo (Fase 4.7) |
| Auditoría HTTP (`attachSecurityAudit`) | ✅ Activo (Fase 1) |
| Validación de firma en webhooks de pago | 🔲 Fase 4.8.3 |
| Idempotencia en procesamiento de webhooks | 🔲 Fase 4.8.7 |
| `audit_logs` granular (actor/acción/antes/después) | 🔲 Fase 16 |

---

## Integraciones

| Integración | Estado | Próximo paso |
|-------------|--------|-------------|
| Supabase Auth (JWT) | Opcional en dev, activo en prod | — |
| Supabase DB | Activo por dominio (feature flag) | Migrar store restante |
| MikroTik RouterOS (lectura) | Activo en Fase 4.6 | — |
| MikroTik RouterOS (escritura live) | Dry-run (Fase 4.5) | Fase 5 |
| WireGuard / VPN | Activo en Fase 4.6–4.7 | — |
| MercadoPago | No iniciado | Fase 4.8.2 |
| OpenPay | No iniciado | Fase 4.8.2 |
| CFDI / PAC | No iniciado | Fase 4.9 |
| Gemini (IA MikroTik) | Activo | Mantener |
| Notificaciones (email/WhatsApp) | No iniciado | Fase 15 |

---

## Referencias

- Arquitectura actual detallada: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
- Arquitectura de billing: [BILLING_ARCHITECTURE.md](BILLING_ARCHITECTURE.md)
- Plan maestro de fases: [NUGACORE_ROADMAP.md](NUGACORE_ROADMAP.md)
- Plan detallado Fase 4.8: [PAYMENT_ENGINE_PHASE_PLAN.md](PAYMENT_ENGINE_PHASE_PLAN.md)
- Roadmap de billing: [BILLING_ROADMAP.md](BILLING_ROADMAP.md)
- Auditoría Fase 4.7: [WIREGUARD_AUTO_ENROLLMENT_REVIEW.md](WIREGUARD_AUTO_ENROLLMENT_REVIEW.md)
- Hotfix Fase 4.7: [WIREGUARD_AUTO_ENROLLMENT_REVIEW_FIXES.md](WIREGUARD_AUTO_ENROLLMENT_REVIEW_FIXES.md)

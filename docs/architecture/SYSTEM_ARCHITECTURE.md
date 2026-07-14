# NugaCore — Arquitectura del Sistema (SYSTEM_ARCHITECTURE)

> Última actualización: 2026-06-01 · Estado: análisis de arquitectura actual + propuesta objetivo.
> Relacionado: [PROJECT_CONTEXT.md](../planning/PROJECT_CONTEXT.md) · [DATABASE_ANALYSIS.md](./DATABASE_ANALYSIS.md) · [API_ANALYSIS.md](./API_ANALYSIS.md)

---

## 1. Arquitectura actual

### 1.1 Modelo de despliegue: monolito de un solo proceso

NugaCore corre hoy como **un único proceso Node.js** que sirve simultáneamente la API y el frontend:

```
                      ┌───────────────────────────────────────────────┐
                      │            Proceso Node (puerto 3000)           │
                      │                                                 │
   Navegador ───────► │  Express app (backend/app.ts)                   │
   (React SPA)        │   1. express.json()                             │
                      │   2. logger (req.method req.path)               │
                      │   3. attachAuthContext   ← resuelve rol         │
                      │   4. attachSecurityAudit ← bitácora HTTP        │
                      │   5. registerRoutes()    ← 14 dominios          │
                      │   6. errorHandler                               │
                      │                                                 │
                      │  Vite middleware (dev)  /  estáticos dist (prod)│
                      │                                                 │
                      │  state/store.ts  ← DATOS EN MEMORIA (mock)      │
                      └───────────────────────────────────────────────┘
```

- **Dev** (`server.ts`): Vite se monta en *middleware mode* dentro de Express → un solo `http://localhost:3000` para todo. No hay CORS porque todo es el mismo origen.
- **Prod** (`npm run build`): `vite build` genera `dist/` y `esbuild` empaqueta `server.ts` → `dist/server.cjs`. Express sirve los estáticos y hace fallback SPA (`app.get('*')`).
- **No hay separación** front/back ni gateway. El frontend asume rutas relativas `/api/*`.

### 1.2 Capas lógicas

```
┌─────────────────────────────────────────────────────────────┐
│ PRESENTACIÓN (src/)                                           │
│  App.tsx  → orquestador único: fetch + estado global + props  │
│  components/*  → 10 módulos (presentacionales + lógica local) │
│  lib/  → supabase, authSession, rbac, apiClient (sin usar)    │
├─────────────────────────────────────────────────────────────┤
│ TRANSPORTE                                                    │
│  fetch /api/* con headers: Authorization, x-user-role, x-user-id │
├─────────────────────────────────────────────────────────────┤
│ API (backend/domains/*/routes.ts)                             │
│  14 routers Express, ~80 endpoints, RBAC por ruta             │
├─────────────────────────────────────────────────────────────┤
│ COMÚN (backend/common/)                                       │
│  auth-context · rbac · action-permissions · security-audit ·  │
│  errors · validators · api-response · logger                  │
├─────────────────────────────────────────────────────────────┤
│ ESTADO / DATOS (backend/state/store.ts)  ← MOCK en memoria    │
├─────────────────────────────────────────────────────────────┤
│ SERVICIOS (backend/services/)                                 │
│  supabase-admin (configurable) · gemini · crypto (AES-GCM)    │
└─────────────────────────────────────────────────────────────┘
```

> ⚠️ **Falta la capa repository.** Hoy las rutas leen/escriben directamente sobre `store.*` (arreglos en memoria). No existe abstracción de datos; migrar a DB exige insertar esa capa.

### 1.3 Frontend en detalle

- **Sin router**: la navegación es un `activeTab` en `useState` dentro de `App.tsx`. Cada tab renderiza un módulo.
- **Estado global = `App.tsx`**: contiene *todos* los datos (`clients`, `invoices`, `towers`, …) y *todos* los handlers (`handleAddClient`, `handlePayInvoice`, …). Se pasan por props a los módulos. No hay Context, Redux ni Zustand.
- **Carga de datos**: una sola función `fetchData()` hace 13 `fetch` en paralelo (`Promise.all`) al montar, y **repite cada 60 s** (polling) para simular tiempo real del NOC.
- **Mutaciones**: cada handler hace su `fetch` y luego vuelve a llamar `fetchData()` completo (refetch total, no actualización optimista).
- **Sesión**: `authSession` guarda perfil + access token en `localStorage`. Si Supabase está configurado, se restaura sesión desde Supabase Auth; si no, se usan perfiles mock (botón "demo").
- **RBAC de UI**: `src/lib/rbac.ts` define qué tabs ve cada rol (`roleTabs`). Es **cosmético**: oculta tabs, no protege datos.

### 1.4 Backend en detalle

- **Modular por dominio**: cada carpeta en `backend/domains/<dominio>/routes.ts` exporta un `Router`. `register-routes.ts` los monta todos.
- **Middleware de auth** (`attachAuthContext`):
  1. Si hay `Bearer` token **y** Supabase admin configurado → valida JWT con `supabaseAdmin.auth.getUser()` y resuelve el rol desde `user_roles`.
  2. Si no hay contexto y los *trusted headers* están permitidos → toma el rol de `x-user-role` que **envía el propio cliente**.
  3. *Trusted headers* se habilitan si `AUTH_TRUST_HEADERS=true` **o** (Supabase ausente **y** no es producción).
- **RBAC** (`requireRoles`, `requireAction`): middlewares que validan `req.authContext.role` contra una lista permitida o una matriz de permisos por acción.
- **Auditoría HTTP** (`attachSecurityAudit`): en `res.on('finish')` registra method/path/status/duración en `store.SECURITY_AUDIT_LOGS` (capado a 5000).
- **Crypto** (`crypto.ts`): AES-256-GCM para credenciales MikroTik. En producción exige `MIKROTIK_CREDENTIALS_KEY`; en dev usa una clave derivada predecible (con warning).

---

## 2. Arquitectura futura (objetivo)

```
┌────────────┐   HTTPS    ┌──────────────────────────────┐
│  Navegador │ ─────────► │  Reverse proxy (Coolify/Traefik)│
│  React SPA │            └───────────────┬────────────────┘
└─────┬──────┘                            │
      │ Supabase Auth (JWT)               ▼
      │ (solo login)         ┌────────────────────────────┐
      └────────────────────► │  Express API (contenedor)   │
                             │  auth(JWT) → RBAC → repo     │
                             └──────┬───────────────┬───────┘
                                    │               │
                          ┌─────────▼──────┐  ┌─────▼────────────┐
                          │ Supabase /      │  │ Worker MikroTik   │
                          │ PostgreSQL      │  │ (RouterOS API)    │
                          │ RLS deny-default│  │ cola de comandos  │
                          └─────────────────┘  └─────┬────────────┘
                                    ▲                 │
                          ┌─────────┴─────────┐       ▼
                          │ Cron / Scheduler  │   Routers MikroTik
                          │ suspensión,        │   en sitio (PPPoE,
                          │ monitoreo, cobranza│   queues, NAT)
                          └────────────────────┘
```

### Cambios clave respecto al actual
1. **Capa repository** entre rutas y Supabase; el `store` en memoria se retira dominio por dominio.
2. **Auth real**: el frontend obtiene JWT de Supabase Auth; Express **siempre** valida el JWT. Los *trusted headers* se eliminan o quedan solo para entornos internos cerrados.
3. **Worker MikroTik** desacoplado: la API encola comandos; el worker ejecuta contra RouterOS y reporta resultados/auditoría.
4. **Scheduler/cron**: suspensión por vencimiento, escaneo de monitoreo y disparo de automatizaciones dejan de ser manuales (endpoint) y pasan a ser jobs.
5. **Observabilidad**: logs estructurados, métricas y backups reales (hoy `backup_policy` es solo configuración).

---

## 3. Frontend (arquitectura propuesta, sin tocar UI)

> Regla: **no se cambia el markup ni los estilos.** Solo se reorganiza la *lógica de datos* por debajo.

1. Extraer el `fetchData()` monolítico a **servicios por dominio** (`src/services/clients.ts`, etc.) reutilizando `apiClient.ts` (hoy huérfano).
2. Introducir **hooks de datos** (`useClients`, `useInvoices`, …) con caché ligera (o React Query) para evitar el refetch total tras cada mutación.
3. Mantener `App.tsx` como ensamblador, pero adelgazarlo: que los hooks vivan junto a cada módulo.
4. Sustituir polling de 60 s por suscripciones realtime de Supabase **donde aporte** (alertas NOC), conservando polling como fallback.

---

## 4. Backend (arquitectura propuesta)

```
backend/
  domains/<dominio>/
    routes.ts        ← HTTP + RBAC (ya existe)
    service.ts       ← reglas de negocio (NUEVO)
    repository.ts    ← acceso a datos + mapeo snake↔camel (NUEVO)
    mappers.ts       ← DB row ↔ tipo de src/types.ts (NUEVO)
  common/            ← ya existe
  services/          ← supabase, gemini, crypto, mikrotik (NUEVO)
  state/store.ts     ← se retira gradualmente
```

- **Repository** encapsula Supabase; las rutas dejan de tocar `store`.
- **Service** concentra reglas (ej. suspensión, conciliación de pagos) hoy embebidas en las rutas.
- **Feature flag por dominio**: `USE_DB_<DOMINIO>` para alternar store↔DB y migrar sin big-bang.

---

## 5. Base de datos

- **Motor**: PostgreSQL (vía Supabase).
- **Esquema**: `supabase/migrations/20260531000000_init_schema.sql` (ya alineado al contrato de datos).
- **RLS**: `20260531000001_rls_and_seeds.sql` habilita RLS deny-by-default en todas las tablas + siembra catálogos (roles, permisos, planes, singletons).
- **Modelo de acceso**: todo pasa por Express con la **service-role key** (bypassa RLS); RLS es defensa en profundidad si filtra la anon key.
- Detalle completo en [DATABASE_ANALYSIS.md](./DATABASE_ANALYSIS.md).

---

## 6. Worker MikroTik

**Hoy:** 100% simulado en `backend/domains/mikrotik/routes.ts`:
- `getSimulatedCommandOutput()` devuelve salidas RouterOS falsas.
- `isReadOnlyCommand()` clasifica comandos en `read`/`write`.
- Escritura bloqueada salvo `confirmWrite=true`; comandos destructivos (`reboot`, `reset configuration`) bloqueados por política.
- Auditoría de cada comando en `MIKROTIK_COMMAND_AUDIT` (allowed/blocked/executed).
- Credenciales cifradas con AES-256-GCM (`crypto.ts`); la API nunca devuelve el password (`sanitizeRouter` expone solo `hasCredentials`).

**Futuro (worker real):**
```
API  ──encola──►  cola de comandos  ──►  Worker
                                          │  conecta RouterOS API (8728/8729 TLS)
                                          │  ejecuta read/write
                                          ▼
                              resultado + auditoría → DB
```
- Separar el worker del proceso web para aislar fallos de red y timeouts.
- Reusar la clasificación read/write y la política de confirmación ya existentes.
- Health check real (CPU/RAM/uptime) reemplaza los valores aleatorios actuales.

---

## 7. Integraciones

| Integración | Estado hoy | Objetivo |
|-------------|-----------|----------|
| **Supabase Auth** | Opcional, fallback a mock/headers | Obligatorio en prod |
| **Supabase DB** | Cliente admin listo, sin usar para datos | Fuente de verdad |
| **Gemini (IA)** | Activo con fallback; copiloto MikroTik | Mantener, revisar nombre de modelo |
| **MikroTik RouterOS** | Simulado | Worker real |
| **Pagos** (Stripe/MercadoPago/OXXO/SPEI/PayPal) | Solo se registran manualmente | Webhooks + pasarela real |
| **CFDI/PAC** | UUID simulado | Timbrado real con PAC |
| **Notificaciones** (email/WhatsApp/Telegram/push) | Solo configuración | Envío real |
| **UISP/Splynx** | No iniciado | Adaptadores futuros |

---

## 8. Flujo de datos

### 8.1 Lectura (carga inicial del dashboard)
```
App.tsx montado
  └─ fetchData()  ── Promise.all ─┬─ GET /api/dashboard-stats
                                  ├─ GET /api/clients
                                  ├─ GET /api/plans
                                  ├─ GET /api/billing/invoices
                                  ├─ GET /api/network-towers
                                  ├─ GET /api/olt /onu /naps
                                  ├─ GET /api/tickets /workorders
                                  ├─ GET /api/inventory
                                  ├─ GET /api/alerts
                                  └─ GET /api/mikrotik/logs
  └─ setState(...)  → render módulos
  └─ setInterval(fetchData, 60s)  → refresco NOC
```

### 8.2 Escritura (ejemplo: registrar un pago)
```
BillingModule  → onPayInvoice(invoiceId, method)
  └─ App.handlePayInvoice → POST /api/billing/invoices/:id/pay
        backend:
          requireRoles(['super admin','administrador','cobranza'])
          syncInvoiceStatus()  → recalcula pendiente/estado
          invoice.payments.push(...)  +  PAYMENT_ALLOCATIONS.unshift(...)
          si cliente suspendido y política lo permite → reactivar:
             client.status='active' + MIKROTIK_LOGS + alerta + bitácora suspensión + timeline
  └─ await fetchData()  → refetch total → UI actualizada
```

### 8.3 Flujo de suspensión/reactivación (cobranza ↔ red)
```
Factura vencida ── automatización/manual ──► cliente.status='suspended'
       │                                          │
       │                                          ▼
       │                            MIKROTIK_LOGS (corte simulado) + alerta NOC + bitácora
       ▼
Pago recibido ──► reactivación automática (si allowAutoReactivateOnPayment)
                                          ▼
                            cliente.status='active' + log + timeline
```

---

## 9. Diagrama de componentes (frontend)

```
                         App.tsx (estado + handlers + fetch)
                              │ props
   ┌──────────┬──────────┬───┴────┬──────────┬──────────┬──────────┐
   ▼          ▼          ▼        ▼          ▼          ▼          ▼
Sidebar   Dashboard   CrmModule Billing  Network   Mikrotik   Support
                                Module   Module    Module     Module
   ▼          ▼                    ▼                              ▼
(tabs)   (KPIs/alertas)      Inventory  Gis     FinanceOwner (finance/owner)
                              Module     Module   Module
   ▲ login
LandingPage / LoginForm  →  authSession (localStorage) + supabase (opcional)
```

---

## 10. Riesgos arquitectónicos

1. **Acoplamiento de datos en `App.tsx`**: todo el estado vive en un componente; cualquier cambio de datos re-renderiza todo y obliga a refetch total.
2. **Sin capa repository**: las reglas de negocio están mezcladas en las rutas (ej. lógica de suspensión en `billing/routes.ts`), difícil de migrar a DB sin refactor.
3. **`store` compartido y mutable**: estado global mutable importado por todas las rutas; en un entorno multi-instancia (escala horizontal) sería incoherente — refuerza la urgencia de la DB.
4. **Proceso único**: un fallo en el worker MikroTik (cuando sea real) podría afectar la API si no se separa.
5. **Polling de 60 s** multiplica carga al escalar usuarios; conviene realtime selectivo.

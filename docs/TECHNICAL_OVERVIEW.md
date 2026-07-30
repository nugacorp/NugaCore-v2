# Resumen técnico del repositorio — NugaCore

> **Actualizado:** 30 de julio de 2026 · **HEAD:** `origin/main`
> **Documento para el equipo de desarrollo.**
>
> **Cómo leer las afirmaciones de este documento.** Lo que dice
> *"verificado"* se comprobó el 2026-07-30 contra el esquema real de staging
> (`elshnzkceutvjzxvzqad`) por conexión Postgres directa o contra el código del
> repo. Lo demás proviene de los informes citados y se atribuye a ellos. Esa
> distinción importa: la revisión previa dio por buenas cosas que la base
> contradecía.
>
> Documentos hermanos, con los que este no debe duplicarse:
> [`reports/PROJECT_STATUS_CURRENT.md`](reports/PROJECT_STATUS_CURRENT.md) (prioridades),
> [`reports/REPO_REVIEW_2026-07-15_29.md`](reports/REPO_REVIEW_2026-07-15_29.md) (retrospectiva),
> [`deployment/SUPABASE_MIGRATIONS_SYNC.md`](deployment/SUPABASE_MIGRATIONS_SYNC.md) (estado de migraciones).
> Este es el **mapa técnico**: cómo está construido, dónde está cada cosa y qué falta.

## 1. Resumen ejecutivo

NugaCore es una plataforma de operaciones (ERP/SaaS) para WISP/ISP: clientes,
facturación, pagos, red (MikroTik/FTTH), NOC, inventario y soporte.

**Veredicto: base funcional amplia, apta para desarrollo y staging. No apta para
producción todavía.** El bloqueo ya no es la persistencia — la mayoría de los
dominios de negocio están en Supabase — sino tres cosas concretas: dos hallazgos
críticos de aislamiento multi-tenant abiertos (MT-01, MT-02), la ausencia de un
motor de ejecución real contra routers, y gates de producción sin recorrer.

Lo que cambió el 2026-07-30 y este documento ya recoge: se cerró el drift de
migraciones que mantenía 39 tablas sin `tenant_id`, se aplicaron las tres
migraciones pendientes y se implementó la capa de Storage que estaba a medias.

## 2. Stack y arquitectura

| Capa | Tecnología |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, Tailwind, Leaflet |
| Backend | Node.js, Express, TypeScript (`tsx` en dev, `esbuild` → CJS en build) |
| Base de datos | Supabase (PostgreSQL + RLS) |
| Despliegue | Docker (`docker-compose` dev/prod), Coolify sobre VPS, GitHub Actions |

### La decisión arquitectónica que explica casi todo lo demás

**El navegador solo usa Supabase para autenticarse.** Verificado: los únicos
métodos de Supabase presentes en `src/` son siete, todos `supabase.auth.*`
(`getSession`, `getUser`, `resend`, `resetPasswordForEmail`,
`signInWithPassword`, `signOut`, `updateUser`). No hay una sola llamada
`.from()`, `.storage` ni `.channel()` en el frontend.

Todo el dato pasa por Express con `service_role`, que bypassa RLS, y la
autorización real la hace el RBAC del backend. Las tablas están en
**deny-by-default**: RLS activa y políticas solo para `service_role`; no existen
políticas `authenticated` **a propósito** — se retiraron tras detectarse una
escalada de privilegios en `is_tenant_member` (ver
[`deployment/SUPABASE_MIGRATIONS_SYNC.md`](deployment/SUPABASE_MIGRATIONS_SYNC.md)).

Esta decisión condiciona qué servicios de Supabase pueden usarse; ver §7.

### Organización del backend

Diseño orientado a dominios: **50 dominios** en `backend/domains/`, cada uno con
sus rutas, servicio y —cuando persiste— su repositorio. **284 rutas `/api`**
(147 GET, 104 POST, 18 PUT, 14 DELETE, 1 PATCH).

Infraestructura común en `backend/common/`: logging con request-id, manejo de
errores tipado (`AppError` y derivados), seguridad HTTP (Helmet + CSP, CORS
allowlist, rate-limit), RBAC y auditoría de seguridad. El orden de middleware
está en [`backend/app.ts`](../backend/app.ts) y es deliberado: coraza → request-id →
body parser → auth → rutas → 404 JSON solo para `/api` → error handler.

### Inventario del repositorio (verificado)

| Métrica | Valor |
| --- | --- |
| Dominios backend | 50 |
| Rutas `/api` | 284 |
| Archivos TypeScript backend | 293 |
| Archivos TypeScript/TSX frontend | 100 |
| Archivos de test | 184 en `tests/unit` (249 archivos en la suite completa) |
| Migraciones SQL | 53 |
| Tablas expuestas en `public` (staging) | 92 |

## 3. Estado de la persistencia

**Corrección respecto a versiones anteriores de este documento:** la persistencia
ya *no* es el bloqueo principal, y la afirmación de que `USE_DB_INVENTORY` está
"desactivada por defecto" era engañosa. En
[`.env.production.example`](../.env.production.example) hay **doce flags en `true`**,
inventario incluido.

La transición memoria → Supabase se controla por dominio con flags
`USE_DB_<DOMINIO>` ([`backend/config/feature-flags.ts`](../backend/config/feature-flags.ts)).
Valores declarados para producción:

| En Supabase (`true`) | En memoria (`false`) |
| --- | --- |
| `CUSTOMERS`, `PLANS`, `BILLING`, `PAYMENTS`, `SUSPENSION`, `INVENTORY`, `SUPPORT`, `COMMERCIAL`, `PURCHASES`, `FINANCE`, `WIREGUARD`, `ROUTER_ENROLLMENT` | `NETWORK`, `FTTH`, `MIKROTIK`, `DASHBOARD`, `GIS`, `AUTOMATIONS`, `REPORTS`, `SECURITY` |

19 dominios tienen `repository.ts` dedicado. Otros (`commercial`, `client-360`,
`collections`) hacen las consultas dentro del propio servicio con
`this.admin.from(...)`, sin fichero de repositorio — mismo efecto, menos
separación.

**Lo que sigue en memoria y por qué importa:** `MIKROTIK`, `NETWORK` y `GIS` en
`false` significa que el inventario de routers y la topología se pierden al
reiniciar el proceso. Para un piloto real eso es un bloqueo; para staging no.

## 4. Estado verificado de la base de datos

Comprobado el 2026-07-30 contra staging.

- **52 migraciones registradas** en `supabase_migrations.schema_migrations`,
  sobre 53 archivos en el repo. El descuadre está explicado: dos colisiones de
  versión (4 archivos ocupando 2 versiones) y un registro huérfano histórico.
- **`tenant_id` presente en 42/42** tablas de negocio del SSOT multi-tenant,
  todas `NOT NULL` y con backfill cerrado. Antes del 2026-07-30 faltaba en 39.
- **Ninguna tabla de `public` sin RLS.**

### Drift resuelto ese día

Dos archivos de migración compartían el prefijo `20260717050000`. El historial
solo admite una fila por versión, así que registró `olt_devices` y
`multi_tenant_complete_ssot` **nunca se ejecutó** — y ningún `db push` futuro
iba a intentarlo, porque la versión constaba como consumida. Efecto visible:
`/api/commercial/*` y `/api/payments/*` devolvían 500, porque el backend
filtraba por una columna que no existía.

Se reparó con `20260730120000_multi_tenant_complete_ssot_reapply.sql`: versión
propia, cuerpo idempotente repetido, sin reescribir historial ni renombrar
archivos. Detalle completo en
[`deployment/SUPABASE_MIGRATIONS_SYNC.md`](deployment/SUPABASE_MIGRATIONS_SYNC.md).

> **Regla que falta automatizar:** dos archivos no pueden compartir versión.
> Comprobación previa a PR —
> `ls supabase/migrations | sed -E 's/_.*//' | sort | uniq -d` debe salir vacío.
> Sigue **sin estar en CI**; es la tarea P1 más barata de todas.

## 5. Filosofía operativa y production gates

**Read-only → Dry-run → Confirmación manual → Live.** Ninguna funcionalidad que
toque infraestructura real se activa por defecto.

Los interruptores viven en
[`backend/config/production-gates.ts`](../backend/config/production-gates.ts): un
master `LIVE_MODE` y ocho gates por subsistema — `mikrotikWorkerLive`,
`mikrotikWorkerCommit`, `notificationsLive`, `automationExecute`,
`provisioningExecute`, `paymentsRouterLive`, `safeCommandQueueLive`,
`serviceStatusLive`. Cada uno cae al valor del master salvo override explícito.

Piezas relacionadas:

- **Safe Command Queue** — modela, valida y audita comandos RouterOS **sin
  ejecutarlos**.
- **Manual Safe Mode** — permite operar CRM/billing con datos reales sin riesgo
  para la red.

## 6. Estado de los módulos

| Módulo | Funcional | Producción | Notas |
| --- | --- | --- | --- |
| Auth / RBAC | ✅ | 🟡 | JWT de Supabase + RBAC en backend. `trusted-headers` ya queda **siempre** deshabilitado en runtime endurecido (`isHardenedRuntime`), no depende de `AUTH_TRUST_HEADERS` |
| Multi-tenant | ✅ | 🔴 | Esquema completo desde el 2026-07-30. **MT-01 y MT-02 abiertos** — ver §8 |
| Clientes / CRM | ✅ | 🟡 | Persistido. Falta validación con volumen real |
| Facturación | ✅ | 🟡 | Persistido. Pendiente auditoría con saldos reales |
| Pagos | ✅ | 🟡 | OpenPay/SPEI/CoDi por WISP, credenciales cifradas (AES-256-GCM), idempotencia por `(tenant, provider, evento)` con lease. **Sin E2E contra sandbox real** |
| Documentos de cliente | ✅ | 🟢 | Storage implementado y verificado extremo a extremo el 2026-07-30 — ver §7 |
| MikroTik / RouterOS | 🟡 | 🔴 | Enrollment vía WireGuard, plantillas `.rsc` con parámetros dinámicos. **No ejecuta escrituras** |
| Provisión | ✅ dry-run | 🔴 | Calcula y audita; no ejecuta |
| NOC | 🟡 read-only | 🟡 | Telemetría SNMP tenant-scoped y vista operativa integradas |
| Inventario | ✅ | 🟡 | `USE_DB_INVENTORY=true` en producción; modelo y UI completos |
| WireGuard | ✅ | 🟢 con gate | Host-apply, IPAM, base multi-tenant tras `WIREGUARD_MULTITENANT` |
| FTTH / GIS | 🟡 | 🔴 | Importador CSV/GeoJSON y NAP integrados; factibilidad y worker OLT fuera de `main` |

## 7. Servicios de Supabase: qué usamos y qué no

Pregunta recurrente del equipo. La respuesta depende de la decisión de §2.

### Storage — implementado el 2026-07-30

Antes existía el hueco: `client_documents.storage_path` se validaba y
persistía, `invoices.pdf_url` y `router_config_backups` lo presuponían, pero
**no había bucket ni una sola llamada a Storage**. Se guardaba la referencia a
un archivo que nadie almacenaba.

Implementación actual:

- Bucket **privado** `client-documents`
  ([`20260730140000`](../supabase/migrations/20260730140000_client_documents_storage_bucket.sql)),
  10 MiB por objeto, solo PDF/PNG/JPEG/WebP. Límites en el propio bucket, no
  solo en el backend.
- Política **únicamente para `service_role`**; nada para `anon`/`authenticated`,
  coherente con el resto del modelo.
- Rutas con prefijo por tenant: `<tenant_id>/<client_id>/<doc_id>-<archivo>`.
  El aislamiento es visible en la propia ruta.
- Flujo en tres pasos —
  [`backend/services/supabase-storage.ts`](../backend/services/supabase-storage.ts):
  1. `POST /api/clients/:id/documents/upload-url` — el backend valida RBAC y
     propiedad por tenant, y firma una URL de subida (120 s).
  2. El navegador sube los bytes **directo al bucket**. No pasan por Express:
     el body limit son 100 kB y proxiar archivos no aporta nada.
  3. `POST /api/clients/:id/documents` registra los metadatos.
  Descarga simétrica por `GET .../documents/:docId/download-url` (URL firmada,
  300 s).

Verificado contra staging: subida firmada `HTTP 200`, descarga firmada con
bytes intactos, y acceso sin firma rechazado con `HTTP 400`. Cobertura en
`tests/unit/client-documents-storage.test.ts` (25 tests).

> **Corregido de paso:** la validación previa de `storagePath` usaba
> `/^[\w./-]+$/`, que **admite `..`**. Con el bucket ya en uso, eso permitía
> registrar un documento apuntando a un objeto de otro WISP y luego pedir su URL
> firmada. Ahora se rechaza `..` y se exige que la ruta empiece por el prefijo
> del tenant.

### Edge Functions — no se usan, y no hacen falta

`supabase/functions` no existe. Y no debería: hay un backend Express con 284
rutas que ya cubre lo que harían, webhooks de pago incluidos. Añadirlas
obligaría a **duplicar la lógica de idempotencia** (`claim_token`, `claimed_at`,
índice único por tenant) en dos runtimes, que es una fuente de bugs, no una
mejora.

El único argumento real sería querer que los webhooks sobrevivan a una caída del
backend. Eso se resuelve con disponibilidad del backend, no partiendo la lógica.

### Realtime — decisión: no usar Supabase Realtime; SSE desde Express cuando haga falta

Hoy no se usa: el frontend hace polling con `setInterval` y backoff ante 429
([`src/App.tsx:650`](../src/App.tsx#L650), [`:717`](../src/App.tsx#L717)). No hay SSE ni
WebSockets en el repo.

**Por qué no Supabase Realtime.** Realtime entrega los cambios *al navegador*
aplicando RLS con el JWT del usuario. Nuestras tablas solo tienen políticas
`service_role`, así que Realtime no entregaría nada. Habilitarlo exigiría crear
políticas `authenticated` sobre las tablas de negocio — exactamente el agujero
que se cerró a propósito y que la migración del 2026-07-30 reafirmó en 42
tablas. **El coste no es técnico, es de modelo de seguridad**, y no compensa.

**Opción elegida para cuando se necesite: SSE (`text/event-stream`) desde
Express.** El backend ya tiene resueltos el tenant y el RBAC, así que filtra
antes de emitir; no se abre RLS, no se añade dependencia, y degrada bien tras
proxy. WebSockets solo si algún día hace falta canal bidireccional, que hoy no
es el caso: todo lo que se querría empujar (alertas NOC, estado de routers,
progreso de enrollment) es unidireccional servidor → cliente.

**No se implementa ahora, deliberadamente.** El polling actual funciona y tiene
backoff; el tiempo real no bloquea ningún gate de producción, mientras que MT-01
y MT-02 sí. Añadir una capa de streaming antes de cerrar el aislamiento
multi-tenant sería ampliar superficie sobre una base con fugas conocidas.
Reconsiderar cuando NOC pase a monitoreo activo, que es donde el polling
empezará a doler de verdad.

## 8. Qué falta

### P0 — bloquean cualquier despliegue

1. ~~Aplicar `20260725210000` y `20260728120000` en staging.~~ **Hecho el 2026-07-30.**
2. ~~Reparar el drift del SSOT multi-tenant.~~ **Hecho el 2026-07-30** (`20260730120000`).
3. **Cerrar MT-01 y MT-02.** Los dos hallazgos críticos de aislamiento. Siguen abiertos.
4. **Confirmar y fusionar el fencing interno de webhooks (T5).** El commit
   `26f0b8c` que lo implementa no era alcanzable desde las referencias remotas en
   la última revisión; hay que recuperarlo, revisarlo en frío y fusionarlo antes
   de desbloquear pagos.

### Los seis hallazgos multi-tenant

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| MT-01 | Crítico | `notifyInvoice` ignora el tenant: factura, cliente, torre y timeline se leen y escriben sin él | Abierto |
| MT-02 | Crítico | La resolución de tenant **falla abierto** hacia `tenant-default`: un error de DB o un usuario sin membresía obtiene acceso al WISP por defecto | Abierto |
| MT-03 | Alto | `wisp_integration_settings.tenant_id` no se persiste desde el repositorio | **Mitad resuelta**: la columna ya existe desde `20260730120000`; falta que el repositorio la escriba |
| MT-04 | Alto | `tenantId` opcional en los contratos de pagos: omitirlo con service-role consulta o actualiza globalmente | Abierto |
| MT-05 | Alto | Las FKs validan el ID del recurso, no que ambos registros compartan tenant. Faltan uniques `(tenant_id, id)` y FKs compuestas | Abierto |
| MT-06 | Medio | El webhook CoDi público no resuelve WISP y cae a `tenant-default` | Abierto |

### P1 — antes de ampliar operación

1. Cerrar MT-03 a MT-06.
2. **Validación en CI que rechace versiones de migración duplicadas.** Barata y
   evita repetir el drift que costó 39 tablas sin `tenant_id`.
3. Probar OpenPay/SPEI/CoDi contra sandbox real autorizado. Hoy la cobertura es
   hermética: no hay evidencia end-to-end con el proveedor.
4. Retomar el carril FTTH: revisar/fusionar PR `#80`, retargetear `#81` a `main`.
5. Recorrer los gates de
   [`deployment/PRODUCTION_READINESS_CHECKLIST.md`](deployment/PRODUCTION_READINESS_CHECKLIST.md):
   persistencia tras reinicio, backups/restore, RBAC por rol.

### P2 — deuda

- Activar protección contra contraseñas filtradas en Supabase (solo Dashboard).
- Migrar a Supabase los dominios que siguen en memoria (`MIKROTIK`, `NETWORK`,
  `GIS`) antes de cualquier piloto real.
- Resolver el baseline de warnings de lint de forma incremental.
- Limpiar ramas remotas de PRs ya cerrados.

### Camino a la ejecución real contra routers

Secuencia obligatoria, sin saltos:

1. **PROD-5** — conectar la Safe Command Queue a un CHR de laboratorio.
2. **PROD-6** — primer comando real, mínimo y reversible, con aprobación manual.
3. **PROD-7** — piloto en un router de producción no crítico.

## 9. Cómo empezar

```bash
npm install
cp .env.example .env        # NODE_ENV=development
npm run dev                 # build + server en http://localhost:3000
```

Verificación antes de abrir PR:

```bash
npm run lint                # eslint + typecheck
npm test                    # suite completa
ls supabase/migrations | sed -E 's/_.*//' | sort | uniq -d   # debe salir vacío
```

Para auditar el esquema de staging sin password de Postgres, ver el bloque de
`curl` al final de
[`deployment/SUPABASE_MIGRATIONS_SYNC.md`](deployment/SUPABASE_MIGRATIONS_SYNC.md):
el spec OpenAPI de PostgREST lista tablas y columnas y sirve para diffear el
repo contra el remoto.

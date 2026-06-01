# NugaCore — Análisis de API (API_ANALYSIS)

> Última actualización: 2026-06-01
> Base: `backend/domains/*/routes.ts` (14 dominios, ~80 endpoints). Todo bajo `/api`.

---

## 1. Convenciones actuales

- **Prefijo:** todos los endpoints cuelgan de `/api` (no hay `/api/v1` formal todavía).
- **Formato de error:** `{ "error": string }` con status HTTP adecuado (400/401/403/404/409/500).
- **Formato de éxito:** **inconsistente** — la mayoría devuelve el recurso "desnudo" (`res.json(client)`, arreglos), pero existe un helper `api-response.ts` (`{ ok, data }` / `{ ok, error }`) **no usado** por las rutas.
- **Auth/identidad:** headers `Authorization: Bearer <jwt>` (Supabase) **y/o** `x-user-role` + `x-user-id` (headers de confianza). El frontend envía ambos (`App.tsx → getAuthHeaders`).
- **RBAC:** por ruta vía `requireRoles([...])` o `requireAction('key')`.
- **Validación:** manual por endpoint (`if (!campo) return 400`); existe `validators.ts` (`requireFields`, `toNumberOr`) de uso parcial.

---

## 2. Catálogo de endpoints por dominio

### Auth (`backend/domains/auth/routes.ts`)
| Método | Ruta | RBAC | Notas |
|--------|------|------|-------|
| GET | `/api/auth/health` | — | salud |
| GET | `/api/auth/me` | — | devuelve `authContext` |

### Clientes (`customers`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/clients` (filtros status/type/city/planId/q) | — (lectura abierta) |
| GET | `/api/clients/:id` | — |
| GET | `/api/clients/:id/history` | — |
| POST | `/api/clients` | super admin, administrador, soporte |
| PUT | `/api/clients/:id` | super admin, administrador, cobranza |
| DELETE | `/api/clients/:id` | super admin, administrador |

### Planes (`plans`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/plans`, `/api/plans/:id` | — |
| POST/PUT/DELETE | `/api/plans[/:id]` | super admin, administrador |

### Facturación (`billing`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/billing/invoices` | — |
| GET | `/api/billing/invoices/:id/account-state` | — |
| GET | `/api/billing/account-summary` | — |
| GET | `/api/billing/revenue-report` | — |
| POST | `/api/billing/invoices/:id/pay` | super admin, administrador, cobranza |
| POST | `/api/billing/invoices` | super admin, administrador, cobranza |
| PUT | `/api/billing/invoices/:id` | super admin, administrador, cobranza |

### Red (`network`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/network-towers`, `/:id`, `/:id/sectors` | — |
| POST/PUT | `/api/network-towers[/:id]` | super admin, administrador, tecnico |
| DELETE | `/api/network-towers/:id` | super admin, administrador |
| POST | `/api/network-towers/:id/state`, `/toggle-state` | super admin, administrador, tecnico |
| POST | `/api/network-towers/:id/sectors` | super admin, administrador, tecnico |
| PUT | `/api/network-sectors/:id` | super admin, administrador, tecnico |
| DELETE | `/api/network-sectors/:id` | super admin, administrador |
| GET | `/api/olt`, `/api/onu`, `/api/naps` | — |
| POST | `/api/onu/provision` | super admin, administrador, tecnico |

### MikroTik (`mikrotik`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/mikrotik/routers`, `/:id` | sa, admin, tecnico, soporte |
| POST/PUT/DELETE | `/api/mikrotik/routers[/:id]` | super admin, administrador |
| GET | `/:id/health`, `/read/interfaces|queues|ppp` | sa, admin, tecnico, soporte |
| GET | `/api/mikrotik/command-audit` | sa, admin, tecnico |
| GET | `/api/mikrotik/logs` | — |
| POST | `/api/mikrotik/command` | sa, admin, tecnico, soporte |
| POST | `/api/mikrotik/copilot` | sa, admin, tecnico, soporte |

### Soporte (`tickets`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/technicians` | — |
| GET | `/api/tickets`, `/:id`, `/:id/history` | — |
| POST | `/api/tickets` | sa, admin, soporte |
| PUT | `/api/tickets/:id` | sa, admin, soporte |
| DELETE | `/api/tickets/:id` | sa, admin |
| POST | `/:id/assign` | sa, admin, soporte |
| POST | `/:id/status`, `/:id/message`, `/:id/attachments` | sa, admin, soporte, tecnico |
| GET | `/api/workorders`, `/:id`, `/agenda` | — |
| POST | `/api/workorders` | sa, admin, soporte |
| PUT | `/api/workorders/:id` | sa, admin, soporte, tecnico |
| DELETE | `/api/workorders/:id` | sa, admin |
| POST | `/:id/checklist/:index/toggle`, `/:id/evidences`, `/:id/update-status` | sa, admin, soporte, tecnico |

### Inventario (`inventory`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/inventory`, `/movements`, `/assignments`, `/:id/state` | — |
| PUT | `/api/inventory/:id`, `/:id/state` | sa, admin, tecnico |
| POST | `/api/inventory/movement`, `/:id/assign`, `/:id/unassign`, `/add` | sa, admin, tecnico |

### Dashboard / Monitoreo / Notificaciones (`dashboard`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/dashboard-stats`, `/dashboard/executive-summary`, `/dashboard/kpi-trends` | — |
| GET | `/api/alerts`, `/api/monitoring/overview|snapshots|targets` | — |
| POST | `/api/alerts/acknowledge-all` | sa, admin, tecnico, soporte |
| POST | `/api/monitoring/ping-scan`, `/basic-alert-rules` | sa, admin, tecnico |
| GET/POST | `/api/notifications/settings` | GET — / POST sa, admin |
| POST | `/api/notifications/trigger-simulation` | sa, admin, tecnico |

### Suspensión (`suspension`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/suspension/policy`, `/logs` | — |
| PUT | `/api/suspension/policy` | sa, admin, cobranza |
| POST | `/api/suspension/run`, `/clients/:id/suspend`, `/clients/:id/reactivate` | sa, admin, cobranza |

### Automatizaciones (`automations`)
| Método | Ruta | RBAC (acción) |
|--------|------|------|
| GET/POST/PUT/DELETE | `/api/automations/rules[/:id]` | `automation.manage` |
| POST | `/api/automations/run` | `automation.execute` |

### Reportes (`reports`)
| Método | Ruta | RBAC (acción) |
|--------|------|------|
| GET | `/api/reports/catalog`, `/summary` | `reports.view` |
| GET | `/api/reports/export` | `reports.export` |

### Seguridad (`security`)
| Método | Ruta | RBAC (acción) |
|--------|------|------|
| GET | `/api/security/audit-logs` | `security.audit.read` |
| GET | `/api/security/permission-matrix` | `security.permissions.read` |
| GET/PUT | `/api/security/backup-policy` | `security.backup.manage` |
| POST | `/api/security/backup/run` | `security.backup.manage` |
| GET | `/api/security/secrets/status` | `security.audit.read` |

### GIS (`gis`)
| Método | Ruta | RBAC |
|--------|------|------|
| GET | `/api/gis/health`, `/layers`, `/map-data`, `/customers`, `/towers` | — |

---

## 3. Contratos y payloads

- **Tipos del frontend** (`src/types.ts`) definen la forma de las respuestas de las entidades principales (`Client`, `Invoice`, `Tower`, `OltFTTH`, `OnuFTTH`, `Ticket`, `TaskOrder`, `WarehouseItem`, `NapBox`, `NocAlert`, `Plan`).
- **Mutaciones aceptan `any`** en el frontend (`handleAddClient(newClientData: any)`) y el backend valida campo por campo. No hay esquema compartido (Zod/JSON Schema).
- **Respuestas enriquecidas**: billing añade `paidAmount`/`pendingAmount`; mikrotik `sanitizeRouter` añade `hasCredentials` y oculta el password.
- **Endpoints de agregación** (dashboard, monitoring, reports) devuelven estructuras ad-hoc no tipadas en el frontend (`stats: any`).

### Problemas de contrato
1. **Inconsistencia de envoltura**: unos endpoints devuelven el recurso desnudo, otros objetos compuestos; `api-response.ts` existe pero no se usa.
2. **`GET` con efectos secundarios**: `/api/billing/invoices` recalcula y muta estados.
3. **Sin paginación**: `/api/clients`, `/api/billing/invoices`, etc. devuelven todo. No escala.
4. **Sin versionado**: no hay `/v1`; un cambio incompatible rompería el frontend.
5. **Tipos `any`** en el contrato frontend para stats/handlers.

---

## 4. Seguridad de la API

> Detalle en [SECURITY_AUDIT.md](SECURITY_AUDIT.md). Resumen aquí:

- 🔴 **Trusted headers**: el cliente declara su rol vía `x-user-role`. Si Supabase no está configurado (default dev) o `AUTH_TRUST_HEADERS=true`, **cualquiera puede actuar como super admin**. RBAC se vuelve cosmético.
- 🟠 **Lecturas abiertas**: muchos `GET` no exigen rol (clientes, facturas, torres, logs MikroTik) → exposición de PII y datos de red sin autenticación efectiva.
- 🟠 **Sin rate limiting / helmet / CORS explícito**: no hay protección contra fuerza bruta o abuso.
- 🟢 **Buenas prácticas presentes**: credenciales MikroTik cifradas y nunca devueltas; comandos de escritura confirmados y auditados; bitácora HTTP de cada request.

---

## 5. Versionado (propuesta)

| Tema | Estado | Propuesta API v1 |
|------|--------|-------------------|
| Prefijo | `/api` | Mantener `/api` como alias de `/api/v1`; documentar v1 como estable |
| Envoltura | mixta | Adoptar `{ ok, data }`/`{ ok, error }` de `api-response.ts` de forma uniforme (con periodo de compatibilidad para no romper el frontend) |
| Paginación | ninguna | `?page`/`?limit` + `{ data, total, page }` en listados grandes |
| Idempotencia | parcial | Claves de idempotencia en pagos/aprovisionamiento |
| Errores | `{ error }` | Mantener + añadir `code` semántico (`CLIENT_NOT_FOUND`) |
| Auth | headers de confianza | **JWT obligatorio**; retirar headers de confianza en prod |
| Validación | manual | Esquemas compartidos (Zod) reutilizados por front y back |

> ⚠️ **Compatibilidad:** dado el congelamiento del frontend, cualquier cambio de envoltura/paginación debe hacerse **aditivo** o tras adaptar `App.tsx`/módulos en el mismo PR. No romper el contrato v1 que el frontend ya consume.

---

## 6. API v1 estable — endpoints "núcleo" a congelar

Estos son los que `App.tsx` consume hoy y **no deben cambiar de forma** sin actualizar el frontend en el mismo cambio:

```
GET  /api/dashboard-stats
GET  /api/clients            GET /api/plans
GET  /api/billing/invoices   GET /api/network-towers
GET  /api/olt  /onu  /naps   GET /api/tickets  /workorders
GET  /api/inventory          GET /api/alerts   /mikrotik/logs
POST /api/clients            PUT /api/clients/:id
POST /api/billing/invoices/:id/pay
POST /api/network-towers/:id/toggle-state
POST /api/onu/provision
POST /api/mikrotik/command   /api/mikrotik/copilot
POST /api/tickets            /api/tickets/:id/message
POST /api/workorders/:id/update-status
POST /api/inventory/movement /api/inventory/add
POST /api/alerts/acknowledge-all
```

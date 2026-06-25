# PROD-9 Notification Engine Foundation — Result

Fecha: 2026-06-24
Rama: `main`
Resultado final: ✅ COMPLETADO (foundation 100% DRY RUN / mock provider)

## Objetivo

Crear el **Notification Engine** de NugaCore: motor central de notificaciones
para Cobranza, NOC, Tickets, Automation, Provisioning, Service Status y
Client 360. En esta fase **NO envía mensajes reales**: opera en modo
DRY RUN / MOCK PROVIDER. No envía WhatsApp/Telegram/Email/Push reales, no
conecta APIs externas, no guarda tokens ni credenciales, no toca RouterOS /
Worker Live / MikroTik. Todo es `dryRun=true`, `sent=false`.

## Dominio backend

`backend/domains/notifications/`

- `types.ts` — tipos, canales, estados, plantillas, mensajes, audit, summary.
- `store.ts` — almacén in-memory (mensajes + bitácora + contadores).
- `providers.ts` — 5 providers mock (FASE E).
- `service.ts` — plantillas (FASE G), render, preview, create, simulate, cancel.
- `audit.ts` — bitácora de transiciones (sin secretos).
- `routes.ts` — endpoints read-only + preview/create/simulate/cancel.

## Tipos (9), Canales (5), Estados (6)

- **NotificationType:** PAYMENT_REMINDER, INVOICE_OVERDUE,
  SERVICE_SUSPENSION_PENDING, SERVICE_REACTIVATION_PENDING, NOC_ALERT,
  TICKET_UPDATE, INSTALLATION_REMINDER, PROVISIONING_STATUS, SYSTEM_ALERT.
- **NotificationChannel:** WHATSAPP, TELEGRAM, EMAIL, PUSH, IN_APP.
- **NotificationStatus:** DRAFT, QUEUED, SIMULATED, SENT, FAILED, CANCELLED.
  En PROD-9 el motor NUNCA asigna SENT (no hay envío real): el flujo llega a
  SIMULATED o CANCELLED. Todos los mensajes llevan `sent=false`.

## Providers mock (FASE E)

`WhatsAppMockProvider`, `TelegramMockProvider`, `EmailMockProvider`,
`PushMockProvider`, `InAppMockProvider`. Cada uno expone `preview()` y devuelve
siempre `{ dryRun:true, provider:'mock', wouldSend:true, sent:false }`. No hay
ninguna primitiva de entrega real.

## Templates (FASE G)

8 plantillas iniciales con interpolación `{{var}}`: recordatorio de pago,
factura vencida, suspensión pendiente, reactivación pendiente, alerta NOC,
ticket actualizado, instalación programada, estado de aprovisionamiento.
Variables soportadas: `customerName`, `amount`, `dueDate`, `invoiceId`,
`serviceStatus`, `ticketId`, `routerName`, `alertType`.

## Endpoints

GET:
- `/api/notifications/templates`
- `/api/notifications/messages` (`?customerId=` opcional)
- `/api/notifications/messages/:id`
- `/api/notifications/summary`

POST:
- `/api/notifications/preview` — vista previa, no persiste.
- `/api/notifications/messages` — crea DRAFT (dry-run).
- `/api/notifications/messages/:id/simulate` — DRAFT/QUEUED → SIMULATED.
- `/api/notifications/messages/:id/cancel` — → CANCELLED.

**No existe** endpoint `/send` ni `/dispatch` real (verificado por contrato y
static-safety).

## Integraciones

- **Automation (FASE H):** la decisión `REQUEST_NOTIFICATION` del Automation
  Engine añade al executionPreview el paso *"Notification would be created
  (dry-run, sin envio real)"*. No envía nada; solo describe.
- **Billing / Client 360 (FASE I/L):** Client 360 incluye sección
  **Notificaciones** (últimos previews, último recordatorio, canal, estado) y
  acción **Crear recordatorio de pago** que dispara una simulación dry-run.
- **NOC (FASE J):** plantilla `NOC_ALERT` disponible para preview (canal IN_APP
  por defecto). No envía Telegram/Push reales.

## UI — Notification Center (FASE K)

Nuevo módulo en **Sistema**, debajo de **Automation Center**. Badge `DRY RUN` y
banner: *"Las notificaciones están en modo simulación. No se envían mensajes
reales."* Pantallas: Resumen, Templates, Mensajes, Simulaciones, Canales.
Botones: Vista previa, Simular, Cancelar. **No** hay botón Enviar ni Dispatch.
Documentado en el Manual de Usuario.

## Dashboard (FASE M)

KPI **Notificaciones Pendientes** = DRAFT + QUEUED + SIMULATED (no cuenta
CANCELLED ni FAILED).

## RBAC (FASE N)

- Lectura: todos los roles (Super Admin, Administrador, Cobranza, Técnico,
  Soporte, Solo lectura).
- Crear / Simular / Cancelar / Preview: Super Admin, Administrador, Cobranza,
  Soporte.
- Bloqueados de escritura: Técnico, Solo lectura (403).

## Auditoría / Static Safety

- Cada transición de estado se audita (tipo, canal, estado previo/siguiente,
  actor, `dryRun=true`, `sent=false`, timestamp). Nunca registra tokens/secretos.
- `notifications.static-safety.test.ts` falla si el dominio contiene primitivas
  de envío real o clientes externos (`fetch(`, `axios`, `twilio`, `nodemailer`,
  `smtp`, `sendgrid`, `mailgun`, `webpush`, `sendmessage`, `dispatch`, `send(`,
  `whatsapp real`, `telegram bot api real`, `push real`).

## Tests (FASE P)

- `tests/contract/notifications.contract.test.ts`
- `tests/contract/notifications.rbac.test.ts`
- `tests/unit/notifications.service.test.ts`
- `tests/unit/notifications.providers.test.ts`
- `tests/unit/notifications.templates.test.ts`
- `tests/unit/notifications.audit.test.ts`
- `tests/unit/notifications.ui.test.ts`
- `tests/unit/notifications.static-safety.test.ts`
- `tests/unit/dashboard.notifications.test.ts`
- `tests/unit/client360.notifications.test.ts`
- `tests/unit/automation.notifications.test.ts`

## Validación

- `npm run typecheck`: PASS (`tsc --noEmit`)
- `npm test`: PASS (`148 passed | 8 skipped` test files; `1769 passed | 49 skipped` tests)
- `npm run build`: PASS (`vite build` + `esbuild server.ts`)

## Qué NO se hizo (límites de la fase)

No se implementó envío real. No se integró WhatsApp/Telegram/Email/Push reales.
No se conectaron APIs externas ni se guardaron tokens. No se avanzó a Worker
Live ni RouterOS. No se avanzó a suspensión/reactivación real.

## Qué debe validar Hermes

1. `POST /api/notifications/preview` y `/messages` devuelven `dryRun=true`,
   `provider='mock'`, `sent=false`; ningún mensaje llega a `SENT`.
2. No existe `/api/notifications/send` ni `/dispatch` (404).
3. Static-safety bloquea primitivas de envío real en el dominio.
4. RBAC: Técnico y Solo lectura reciben 403 al crear/simular/cancelar.
5. KPI Dashboard, sección Client 360 y preview de Automation reflejan datos
   dry-run sin efectos reales.

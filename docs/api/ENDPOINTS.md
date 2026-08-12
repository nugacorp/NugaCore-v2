# Documentación de Endpoints de la API - NugaCore

Este documento lista los endpoints de la API generados automáticamente a partir del código fuente en `backend/domains`.

## auth

- `GET /api/auth/health`
- `GET /api/auth/me`

## automation

- `GET /api/automation/rules`
- `GET /api/automation/rules/:id`
- `GET /api/automation/events`
- `GET /api/automation/decisions`
- `GET /api/automation/audit`
- `GET /api/automation/summary`
- `POST /api/automation/simulate`
- `POST /api/automation/decisions/:id/notify-preview`
- `POST /api/automation/notify-pending`

## automations

- `GET /api/automations/rules`
- `POST /api/automations/rules`
- `PUT /api/automations/rules/:id`
- `DELETE /api/automations/rules/:id`
- `POST /api/automations/run`

## billing

- `GET /api/billing/invoices`
- `GET /api/billing/payments`
- `GET /api/billing/invoices/:id`
- `GET /api/billing/account-summary`
- `GET /api/billing/revenue-report`
- `POST /api/billing/payments`
- `POST /api/billing/run-cycle`

## client-360

- `GET /api/clients/:clientId/expediente`
- `GET /api/clients/:clientId/tags`
- `POST /api/clients/:clientId/tags`
- `DELETE /api/clients/:clientId/tags/:tagId`
- `GET /api/clients/:clientId/contacts`
- `POST /api/clients/:clientId/contacts`
- `GET /api/clients/:clientId/documents`
- `POST /api/clients/:clientId/documents/upload-url`
- `POST /api/clients/:clientId/documents`
- `GET /api/clients/:clientId/documents/:documentId/download-url`
- `GET /api/clients/:clientId/activity`

## client-actions

- `POST /api/client-actions/:clientId/payment`
- `POST /api/client-actions/:clientId/ticket`
- `POST /api/client-actions/:clientId/work-order`

## collections

- `GET /api/collections/promises`
- `POST /api/collections/promises`
- `POST /api/collections/promises/:id/fulfill`
- `GET /api/collections/cash-register`
- `POST /api/collections/cash-register/entries`

## commercial

- `GET /api/commercial/pipeline`
- `GET /api/commercial/prospects`
- `GET /api/commercial/prospects/:id`
- `POST /api/commercial/prospects`
- `POST /api/commercial/prospects/:id/advance`
- `POST /api/commercial/prospects/:id/convert`
- `GET /api/commercial/quotes`
- `POST /api/commercial/quotes`
- `GET /api/commercial/appointments`
- `POST /api/commercial/appointments`

## customers

- `GET /api/clients`
- `GET /api/clients/:id/history`
- `GET /api/clients/:id`
- `POST /api/clients`
- `PUT /api/clients/:id`
- `DELETE /api/clients/:id`

## dashboard

- `GET /api/dashboard-stats`
- `GET /api/dashboard/executive-summary`
- `GET /api/dashboard/kpi-trends`
- `GET /api/dashboard/billing-kpis`
- `GET /api/notifications/settings`
- `POST /api/notifications/settings`
- `POST /api/notifications/trigger-simulation`
- `GET /api/alerts`
- `GET /api/monitoring/overview`
- `GET /api/monitoring/snapshots`
- `GET /api/monitoring/targets`
- `POST /api/monitoring/ping-scan`
- `POST /api/monitoring/basic-alert-rules`
- `POST /api/alerts/acknowledge-all`
- `GET /api/dashboard/control-center`
- `GET /api/dashboard/zones`

## finance-operational

- `GET /api/finance/operational/expenses`
- `POST /api/finance/operational/expenses`
- `DELETE /api/finance/operational/expenses/:id`
- `GET /api/finance/operational/pnl`
- `GET /api/finance/cfdi/status`

## gis

- `GET /api/gis/health`
- `GET /api/gis/layers`
- `GET /api/gis/map-data`
- `GET /api/gis/customers`
- `GET /api/gis/towers`

## health

- `GET /api/health`
- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/metrics/prometheus`

## integrations

- `GET /api/integrations/settings`
- `PUT /api/integrations/settings`
- `POST /api/integrations/test/:provider`
- `POST /api/billing/invoices/:id/notify`
- `POST /api/payments/webhook/codi`

// ====================================================================
// Service del dominio Service Status (Pre-PROD-7).
//
// Fuente OFICIAL del estado operativo de servicio. Deriva serviceStatus a
// partir del estado administrativo (CRM) + el estado financiero (Billing) +
// una solicitud pendiente opcional. Las solicitudes (request-suspension /
// request-reactivation) SOLO marcan el estado como pendiente (dryRun) y dejan
// auditoría: no ejecutan cambios reales en la red ni en equipos.
// ====================================================================

import type { Client } from '../../../src/types';
import type { EnrichedInvoice } from '../billing/repository';
import { getBillingService } from '../billing/service';
import { getCustomersService } from '../customers/service';
import { serviceStatusStore } from './store';
import {
  BillingStatusLite,
  PendingRequest,
  ServiceStatus,
  ServiceStatusAuditEvent,
  ServiceStatusSummary,
  ServiceStatusView,
} from './types';

const SERVICEABLE: Client['status'][] = ['active', 'suspended'];

export const ALL_SERVICE_STATUSES: ServiceStatus[] = [
  'ACTIVE',
  'PENDING_INSTALL',
  'SUSPENSION_PENDING',
  'SUSPENDED',
  'REACTIVATION_PENDING',
  'CANCELLED',
];

export class ServiceStatusError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'ServiceStatusError';
  }
}

// ── Derivación pura (sin efectos) ─────────────────────────────────────
/**
 * Calcula el estado operativo oficial. Prioridad:
 *   1. baja → CANCELLED ; lead → PENDING_INSTALL (no serviceable)
 *   2. solicitud pendiente (overlay del operador)
 *   3. derivación por CRM + cobranza
 */
export function deriveServiceStatus(input: {
  customerStatus: Client['status'];
  billingStatus: BillingStatusLite;
  pendingRequest: PendingRequest | null;
}): { status: ServiceStatus; reason: string } {
  const { customerStatus, billingStatus, pendingRequest } = input;

  if (customerStatus === 'baja') {
    return { status: 'CANCELLED', reason: 'Cliente cancelado (baja administrativa).' };
  }
  if (customerStatus === 'lead') {
    return { status: 'PENDING_INSTALL', reason: 'Cliente nuevo aún sin instalación completada.' };
  }

  if (pendingRequest === 'suspension') {
    return { status: 'SUSPENSION_PENDING', reason: 'Suspensión solicitada, pendiente de aplicar.' };
  }
  if (pendingRequest === 'reactivation') {
    return { status: 'REACTIVATION_PENDING', reason: 'Reactivación solicitada, pendiente de aplicar.' };
  }

  if (customerStatus === 'suspended') {
    return billingStatus === 'OVERDUE'
      ? { status: 'SUSPENDED', reason: 'Servicio suspendido en NugaCore con adeudo vencido.' }
      : { status: 'REACTIVATION_PENDING', reason: 'Saldo regularizado: reactivación pendiente de aplicar.' };
  }

  // customerStatus === 'active'
  return billingStatus === 'OVERDUE'
    ? { status: 'SUSPENSION_PENDING', reason: 'Adeudo vencido: suspensión pendiente de aplicar.' }
    : { status: 'ACTIVE', reason: 'Servicio activo y al corriente.' };
}

// ── Carga de contexto desde las fuentes oficiales ─────────────────────
async function loadContext(): Promise<{ clients: Client[]; invoices: EnrichedInvoice[] }> {
  const [clients, invoices] = await Promise.all([
    getCustomersService().list({}),
    getBillingService().listInvoices(),
  ]);
  return { clients, invoices };
}

function billingStatusFor(customerId: string, invoices: EnrichedInvoice[]): BillingStatusLite {
  const hasOverdue = invoices.some(
    (inv) => inv.clientId === customerId && inv.status === 'overdue',
  );
  return hasOverdue ? 'OVERDUE' : 'CURRENT';
}

function toView(client: Client, invoices: EnrichedInvoice[]): ServiceStatusView {
  const overlay = serviceStatusStore.getOverlay(client.id);
  const billingStatus = billingStatusFor(client.id, invoices);
  const pendingRequest = overlay?.pendingRequest ?? null;
  const derived = deriveServiceStatus({ customerStatus: client.status, billingStatus, pendingRequest });
  return {
    customerId: client.id,
    customerName: client.name,
    customerStatus: client.status,
    billingStatus,
    serviceStatus: derived.status,
    routerStatus: null,
    pendingRequest,
    reason: derived.reason,
    updatedAt: overlay?.updatedAt ?? null,
  };
}

// ── API read-only ─────────────────────────────────────────────────────
export async function listServiceStatuses(): Promise<ServiceStatusView[]> {
  const { clients, invoices } = await loadContext();
  return clients.map((client) => toView(client, invoices));
}

export async function getServiceStatus(customerId: string): Promise<ServiceStatusView | null> {
  const { clients, invoices } = await loadContext();
  const client = clients.find((c) => c.id === customerId);
  return client ? toView(client, invoices) : null;
}

export async function getServiceStatusSummary(): Promise<ServiceStatusSummary> {
  const views = await listServiceStatuses();
  const byStatus = Object.fromEntries(
    ALL_SERVICE_STATUSES.map((status) => [status, 0]),
  ) as Record<ServiceStatus, number>;
  for (const view of views) byStatus[view.serviceStatus] += 1;
  return { generatedAt: new Date().toISOString(), total: views.length, byStatus };
}

/** Conteo oficial de SUSPENDED — fuente del KPI "Suspendidos". */
export async function countSuspended(): Promise<number> {
  const summary = await getServiceStatusSummary();
  return summary.byStatus.SUSPENDED;
}

export function listServiceStatusAudit(customerId?: string): ServiceStatusAuditEvent[] {
  return serviceStatusStore.listAudit(customerId);
}

// ── Solicitudes controladas (dryRun, sin ejecución real) ──────────────
async function requestTransition(
  customerId: string,
  pendingRequest: PendingRequest,
  reason: string,
  actorRole: string | null,
): Promise<{ event: ServiceStatusAuditEvent; view: ServiceStatusView }> {
  const { clients, invoices } = await loadContext();
  const client = clients.find((c) => c.id === customerId);
  if (!client) {
    throw new ServiceStatusError('Customer not found', 'NOT_FOUND', 404);
  }
  if (!SERVICEABLE.includes(client.status)) {
    throw new ServiceStatusError(
      'Only serviceable customers (active/suspended) can request a transition',
      'NOT_SERVICEABLE',
      409,
    );
  }

  const previousStatus = toView(client, invoices).serviceStatus;
  const updatedAt = new Date().toISOString();
  serviceStatusStore.putOverlay(customerId, { pendingRequest, reason, updatedAt });

  const view = toView(client, invoices);
  const event: ServiceStatusAuditEvent = {
    id: serviceStatusStore.nextEventId(),
    customerId,
    previousStatus,
    nextStatus: view.serviceStatus,
    reason,
    actorRole,
    createdAt: updatedAt,
    dryRun: true,
  };
  serviceStatusStore.appendAudit(event);
  return { event, view };
}

export function requestSuspension(
  customerId: string,
  reason: string,
  actorRole: string | null,
): Promise<{ event: ServiceStatusAuditEvent; view: ServiceStatusView }> {
  return requestTransition(
    customerId,
    'suspension',
    reason || 'Suspensión solicitada por operación.',
    actorRole,
  );
}

export function requestReactivation(
  customerId: string,
  reason: string,
  actorRole: string | null,
): Promise<{ event: ServiceStatusAuditEvent; view: ServiceStatusView }> {
  return requestTransition(
    customerId,
    'reactivation',
    reason || 'Reactivación solicitada por operación.',
    actorRole,
  );
}

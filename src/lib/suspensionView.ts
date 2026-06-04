// ====================================================================
// Helpers PUROS de presentación del Motor de Suspensiones (Fase 4.5).
// Sin React/DOM → testeables en node.
// ====================================================================

import type {
  CustomerServiceView,
  ServiceStatus,
  SuspensionBillingStatus,
  SuspensionOrderStatus,
} from '../types';

export type Tone = 'active' | 'warning' | 'danger' | 'suspended' | 'info' | 'neutral';

export interface Badge {
  label: string;
  tone: Tone;
}

export const serviceStatusBadge = (status: ServiceStatus): Badge => {
  switch (status) {
    case 'ACTIVE': return { label: 'Activo', tone: 'active' };
    case 'WARNING': return { label: 'Advertencia', tone: 'warning' };
    case 'PENDING_SUSPENSION': return { label: 'Por suspender', tone: 'danger' };
    case 'SUSPENDED': return { label: 'Suspendido', tone: 'suspended' };
    case 'PENDING_REACTIVATION': return { label: 'Por reactivar', tone: 'info' };
    default: return { label: status, tone: 'neutral' };
  }
};

export const billingStatusBadge = (status: SuspensionBillingStatus): Badge => {
  switch (status) {
    case 'CURRENT': return { label: 'Al corriente', tone: 'active' };
    case 'DUE_SOON': return { label: 'Por vencer', tone: 'info' };
    case 'OVERDUE': return { label: 'Vencida', tone: 'warning' };
    case 'DELINQUENT': return { label: 'Moroso', tone: 'danger' };
    default: return { label: status, tone: 'neutral' };
  }
};

export const orderStatusBadge = (status: SuspensionOrderStatus): Badge => {
  switch (status) {
    case 'PENDING': return { label: 'Pendiente', tone: 'warning' };
    case 'QUEUED': return { label: 'En cola', tone: 'info' };
    case 'EXECUTED': return { label: 'Ejecutada', tone: 'active' };
    case 'FAILED': return { label: 'Fallida', tone: 'danger' };
    case 'CANCELLED': return { label: 'Cancelada', tone: 'neutral' };
    default: return { label: status, tone: 'neutral' };
  }
};

export interface ServiceBuckets {
  ACTIVE: number;
  WARNING: number;
  PENDING_SUSPENSION: number;
  SUSPENDED: number;
  PENDING_REACTIVATION: number;
}

/** Cuenta clientes por ServiceStatus (para las columnas de la UI). */
export const bucketByServiceStatus = (customers: CustomerServiceView[]): ServiceBuckets => {
  const buckets: ServiceBuckets = {
    ACTIVE: 0, WARNING: 0, PENDING_SUSPENSION: 0, SUSPENDED: 0, PENDING_REACTIVATION: 0,
  };
  for (const c of customers) {
    if (c.serviceStatus in buckets) buckets[c.serviceStatus] += 1;
  }
  return buckets;
};

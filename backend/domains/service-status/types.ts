// ====================================================================
// Service Status — Single Source of Truth del estado operativo (Pre-PROD-7).
//
// Este dominio DEFINE y CALCULA el estado oficial de servicio de cada cliente.
// NO suspende, NO reactiva, NO ejecuta cambios reales en la red ni en equipos.
// Solo deriva el estado y, en los endpoints de solicitud, lo marca como
// pendiente (dryRun) dejando un audit trail.
//
// Cuatro dimensiones que NO deben mezclarse:
//   - customerStatus : estado administrativo (CRM).
//   - billingStatus  : estado financiero (cobranza).
//   - serviceStatus  : estado operativo OFICIAL en NugaCore (este dominio).
//   - routerStatus   : estado observado en la red (no disponible aquí; null).
// ====================================================================

import type { Client } from '../../../src/types';

/** Estado operativo oficial del servicio en NugaCore (no es estado de red). */
export type ServiceStatus =
  | 'ACTIVE'
  | 'PENDING_INSTALL'
  | 'SUSPENSION_PENDING'
  | 'SUSPENDED'
  | 'REACTIVATION_PENDING'
  | 'CANCELLED';

/** Estado financiero simplificado para la derivación de serviceStatus. */
export type BillingStatusLite = 'CURRENT' | 'OVERDUE';

/** Solicitud operativa pendiente de aplicar (overlay dryRun). */
export type PendingRequest = 'suspension' | 'reactivation';

/** Vista oficial de estado por cliente (read-only). */
export interface ServiceStatusView {
  customerId: string;
  customerName: string;
  /** Estado administrativo del CRM. */
  customerStatus: Client['status'];
  /** Estado financiero (cobranza). */
  billingStatus: BillingStatusLite;
  /** Estado operativo OFICIAL. */
  serviceStatus: ServiceStatus;
  /** Estado observado en la red. No disponible en este dominio → null. */
  routerStatus: string | null;
  /** Solicitud pendiente registrada (sin ejecutar). */
  pendingRequest: PendingRequest | null;
  reason: string;
  updatedAt: string | null;
}

/** Evento de auditoría de cada cambio de estado (siempre dryRun). */
export interface ServiceStatusAuditEvent {
  id: string;
  customerId: string;
  previousStatus: ServiceStatus;
  nextStatus: ServiceStatus;
  reason: string;
  actorRole: string | null;
  createdAt: string;
  dryRun: boolean;
}

export interface ServiceStatusSummary {
  generatedAt: string;
  total: number;
  byStatus: Record<ServiceStatus, number>;
}

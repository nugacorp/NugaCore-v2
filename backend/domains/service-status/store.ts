// ====================================================================
// Estado en memoria del dominio Service Status (mock, dryRun).
//
// Guarda el overlay de solicitudes pendientes por cliente y el audit trail.
// No persiste en DB ni toca otros dominios. `reset()` permite aislar tests.
// ====================================================================

import type { PendingRequest, ServiceStatusAuditEvent } from './types';

interface PendingOverlay {
  pendingRequest: PendingRequest | null;
  reason: string;
  updatedAt: string;
}

class ServiceStatusStore {
  private overlays: Record<string, PendingOverlay> = {};
  private auditLog: ServiceStatusAuditEvent[] = [];
  private seq = 0;

  getOverlay(customerId: string): PendingOverlay | null {
    return this.overlays[customerId] ?? null;
  }

  putOverlay(customerId: string, overlay: PendingOverlay): void {
    this.overlays[customerId] = overlay;
  }

  clearOverlay(customerId: string): void {
    delete this.overlays[customerId];
  }

  appendAudit(event: ServiceStatusAuditEvent): void {
    this.auditLog.unshift(event);
  }

  listAudit(customerId?: string): ServiceStatusAuditEvent[] {
    return customerId
      ? this.auditLog.filter((event) => event.customerId === customerId)
      : [...this.auditLog];
  }

  nextEventId(): string {
    this.seq += 1;
    return `svc-evt-${Date.now()}-${this.seq}`;
  }

  reset(): void {
    this.overlays = {};
    this.auditLog = [];
    this.seq = 0;
  }
}

export const serviceStatusStore = new ServiceStatusStore();

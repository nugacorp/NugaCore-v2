// ====================================================================
// Cola de acciones OLT — contratos del dominio.
//
// Espejo de `mikrotik_actions`: la cola persistente que un worker consumirá.
// Mientras no exista driver de transporte validado contra hardware, TODA acción
// se encola con dryRun=true y nadie la ejecuta.
// ====================================================================

import type { OltActionType, OnuActionPayload } from '../command-builder';
import type { OltCliFlavor } from '../types';

export const OLT_ACTION_STATUSES = [
  'pending',
  'executing',
  'completed',
  'failed',
  'skipped',
] as const;
export type OltActionStatus = (typeof OLT_ACTION_STATUSES)[number];

export interface OltActionRecord {
  id: string;
  tenantId: string;
  oltId: string;
  customerId?: string;
  onuId?: string;
  actionType: OltActionType;
  status: OltActionStatus;
  /** Siempre true en esta fase. Ver `OltActionsService.enqueue`. */
  dryRun: boolean;
  cliFlavor: OltCliFlavor;
  payload: OnuActionPayload;
  /** Plan CLI generado al encolar (auditable antes de habilitar ejecución). */
  plannedCommands: string[];
  warnings: string[];
  result?: Record<string, unknown>;
  attempts: number;
  triggeredBy?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueOltActionInput {
  oltId: string;
  actionType: OltActionType;
  payload?: OnuActionPayload;
  customerId?: string;
  onuId?: string;
  triggeredBy?: string;
}

export interface OltActionFilters {
  oltId?: string;
  customerId?: string;
  status?: OltActionStatus;
}

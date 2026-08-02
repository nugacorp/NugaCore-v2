// ====================================================================
// Servicio de la cola de acciones OLT.
//
// Encola acciones con su plan de comandos ya traducido a la familia de CLI de
// la OLT destino. NO ejecuta: `dryRun` se fuerza a true hasta que exista un
// driver de transporte validado contra hardware real.
// ====================================================================

import { randomBytes } from 'crypto';
import { nowIso } from '../../../common/time';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../../services/supabase-admin';
import { suggestConfig } from '../config-advisor';
import { buildOltCommandPlan, type OnuActionPayload } from '../command-builder';
import { useDbOlt } from '../repository';
import { getOltService } from '../service';
import type { OltCliFlavor } from '../types';
import {
  StoreOltActionsRepository,
  SupabaseOltActionsRepository,
  type OltActionsRepository,
} from './repository';
import type {
  EnqueueOltActionInput,
  OltActionFilters,
  OltActionRecord,
  OltActionStatus,
} from './types';

/**
 * Interruptor de ejecución. Mientras sea false, la cola es un registro
 * auditable de intenciones: ningún worker toca la OLT.
 */
export const OLT_EXECUTION_ENABLED = false;

export class OltNotFoundError extends Error {
  constructor(oltId: string) {
    super(`OLT no encontrada: ${oltId}`);
    this.name = 'OltNotFoundError';
  }
}

const genId = (): string => `oa-${randomBytes(6).toString('hex')}`;

let repoSingleton: OltActionsRepository | null = null;

const getRepo = (): OltActionsRepository => {
  if (repoSingleton) return repoSingleton;
  repoSingleton = useDbOlt() && isSupabaseAdminConfigured && supabaseAdmin
    ? new SupabaseOltActionsRepository(supabaseAdmin)
    : new StoreOltActionsRepository();
  return repoSingleton;
};

export class OltActionsService {
  list(tenantId: string, filters?: OltActionFilters): Promise<OltActionRecord[]> {
    return getRepo().list(tenantId, filters);
  }

  get(tenantId: string, id: string): Promise<OltActionRecord | null> {
    return getRepo().get(tenantId, id);
  }

  /**
   * Encola una acción resolviendo la familia de CLI de la OLT destino.
   * Lanza OltNotFoundError si la OLT no existe en el tenant: encolar contra un
   * destino inexistente produce trabajo que ningún worker podría ejecutar.
   */
  async enqueue(tenantId: string, input: EnqueueOltActionInput): Promise<OltActionRecord> {
    const device = await getOltService().get(tenantId, input.oltId);
    if (!device) throw new OltNotFoundError(input.oltId);

    const flavor = this.resolveFlavor(device.configProfile, device.brand, device.model);
    const payload: OnuActionPayload = input.payload ?? {};
    const plan = buildOltCommandPlan(flavor, input.actionType, payload);
    const now = nowIso();

    return getRepo().create({
      id: genId(),
      tenantId,
      oltId: input.oltId,
      customerId: input.customerId,
      onuId: input.onuId,
      actionType: input.actionType,
      status: 'pending',
      // Forzado: no depende del cliente de la API.
      dryRun: !OLT_EXECUTION_ENABLED,
      cliFlavor: flavor,
      payload,
      plannedCommands: plan.commands,
      warnings: plan.warnings,
      attempts: 0,
      triggeredBy: input.triggeredBy,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Cancela una acción pendiente (status → skipped). */
  async cancel(tenantId: string, id: string, reason?: string): Promise<OltActionRecord | null> {
    const action = await getRepo().get(tenantId, id);
    if (!action) return null;
    if (action.status !== 'pending') return action;
    return getRepo().update(tenantId, id, {
      status: 'skipped' as OltActionStatus,
      errorMessage: reason,
    });
  }

  /** Familia de CLI: primero el snapshot guardado, si no se re-deriva del catálogo. */
  private resolveFlavor(
    configProfile: Record<string, unknown> | undefined,
    brand: string,
    model: string,
  ): OltCliFlavor {
    const stored = configProfile?.cliFlavor;
    if (typeof stored === 'string' && stored) return stored as OltCliFlavor;
    return suggestConfig({ brand, model }).cliFlavor;
  }
}

let serviceSingleton: OltActionsService | null = null;

export const getOltActionsService = (): OltActionsService => {
  if (!serviceSingleton) serviceSingleton = new OltActionsService();
  return serviceSingleton;
};

export const resetOltActionsService = (): void => {
  serviceSingleton = null;
  repoSingleton = null;
};

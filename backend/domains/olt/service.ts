// ====================================================================
// Servicio del dominio OLT: CRUD + sugerencia de configuración + script.
// ====================================================================

import { randomBytes } from 'crypto';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { nowIso } from '../../common/time';
import {
  OltRepository,
  StoreOltRepository,
  SupabaseOltRepository,
  useDbOlt,
} from './repository';
import { suggestConfig, listCatalog, isKnownModel } from './config-advisor';
import { generateOltScript } from './script-generator';
import type {
  OltDevice,
  OltReachability,
  OltScriptResult,
  PonType,
} from './types';

let repoSingleton: OltRepository | null = null;
export const resetOltService = (): void => { repoSingleton = null; };

const getRepo = (): OltRepository => {
  if (repoSingleton) return repoSingleton;
  repoSingleton = useDbOlt() && isSupabaseAdminConfigured && supabaseAdmin
    ? new SupabaseOltRepository(supabaseAdmin)
    : new StoreOltRepository();
  return repoSingleton;
};

const genId = (): string => `olt-${randomBytes(6).toString('hex')}`;

export interface CreateOltInput {
  name: string;
  brand: string;
  model: string;
  ponType?: PonType;
  managementIp: string;
  managementVlan?: number;
  sshPort?: number;
  sshUsername?: string;
  towerId?: string;
  mikrotikRouterId?: string;
  uplinkPort?: string;
  notes?: string;
}

export class OltService {
  list(tenantId: string): Promise<OltDevice[]> {
    return getRepo().list(tenantId);
  }

  get(tenantId: string, id: string): Promise<OltDevice | null> {
    return getRepo().get(tenantId, id);
  }

  catalog() {
    return listCatalog();
  }

  /** Sugiere configuración inicial (no persiste nada). */
  suggest(brand: string, model: string, opts?: { ponType?: PonType; managementVlan?: number }) {
    return suggestConfig({ brand, model, ponType: opts?.ponType, managementVlan: opts?.managementVlan });
  }

  async create(tenantId: string, input: CreateOltInput): Promise<OltDevice> {
    const now = nowIso();
    const rec = suggestConfig({
      brand: input.brand,
      model: input.model,
      ponType: input.ponType,
      managementVlan: input.managementVlan,
    });
    const device: OltDevice = {
      id: genId(),
      tenantId,
      name: input.name,
      brand: input.brand,
      model: input.model,
      ponType: rec.ponType,
      managementIp: input.managementIp,
      managementVlan: input.managementVlan,
      sshPort: input.sshPort ?? 22,
      sshUsername: input.sshUsername,
      towerId: input.towerId,
      mikrotikRouterId: input.mikrotikRouterId,
      uplinkPort: input.uplinkPort,
      provisioningStatus: 'planned',
      // Snapshot del perfil recomendado (settings/capacidad, SIN secretos).
      configProfile: {
        cliFlavor: rec.cliFlavor,
        recommendedSplit: rec.capacity.recommendedSplit,
        settings: rec.settings,
        knownModel: isKnownModel(input.brand, input.model),
        suggestedAt: now,
      },
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    return getRepo().create(device);
  }

  update(tenantId: string, id: string, patch: Partial<OltDevice>): Promise<OltDevice | null> {
    return getRepo().update(tenantId, id, patch);
  }

  remove(tenantId: string, id: string): Promise<boolean> {
    return getRepo().remove(tenantId, id);
  }

  /** Genera el script de arranque + snippet MikroTik para una OLT existente. */
  async script(tenantId: string, id: string, reachability?: OltReachability): Promise<OltScriptResult | null> {
    const device = await getRepo().get(tenantId, id);
    if (!device) return null;
    const rec = suggestConfig({
      brand: device.brand,
      model: device.model,
      ponType: device.ponType,
      managementVlan: device.managementVlan,
    });
    return generateOltScript({ device, recommendation: rec, reachability });
  }
}

let serviceSingleton: OltService | null = null;
export const getOltService = (): OltService => {
  if (!serviceSingleton) serviceSingleton = new OltService();
  return serviceSingleton;
};

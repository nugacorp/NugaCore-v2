// ====================================================================
// Service del dominio Plans.
//
// Concentra reglas de negocio y validaciones del plan, y delega la
// persistencia al repository (store mock o Supabase, según USE_DB_PLANS).
// No conoce Express (sin req/res): es lógica pura y testeable.
// ====================================================================

import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { BadRequestError, ConflictError } from '../../common/errors';
import { logger } from '../../common/logger';
import { PlanBusinessType, PlanRecord, PlanTechType } from './mappers';
import {
  PlanFilters,
  PlansRepository,
  StorePlansRepository,
  SupabasePlansRepository,
} from './repository';

const TECH_TYPES: PlanTechType[] = ['PPPoE', 'Hotspot', 'DHCP', 'Static'];

/** Normaliza el tipo de negocio (mismo criterio que el routes.ts previo). */
export const asBusinessType = (value: unknown): PlanBusinessType => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'empresarial') return 'Empresarial';
  if (normalized === 'dedicado') return 'Dedicado';
  return 'Residencial';
};

/** Normaliza el tipo técnico a su forma canónica del enum, o null si no es válido. */
export const parsePlanTechType = (value: unknown): PlanTechType | null => {
  const normalized = String(value || '').trim().toLowerCase();
  return TECH_TYPES.find((t) => t.toLowerCase() === normalized) ?? null;
};

export interface CreatePlanInput {
  name?: unknown;
  speedMbpsDown?: unknown;
  speedMbpsUp?: unknown;
  price?: unknown;
  type?: unknown;
  businessType?: unknown;
  isActive?: unknown;
}

/** Campos ya validados/normalizados de un alta (todo lo necesario salvo el id). */
export type ValidatedPlan = Omit<PlanRecord, 'id'>;

export class PlansService {
  constructor(private readonly repo: PlansRepository) {}

  // --- Validaciones --------------------------------------------------
  private parseNonNegativeNumber(value: unknown, field: string): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new BadRequestError(`Invalid ${field}: must be a number`, 'INVALID_NUMBER');
    }
    if (n < 0) {
      throw new BadRequestError(`Invalid ${field}: must be >= 0`, 'INVALID_NUMBER');
    }
    return n;
  }

  /** Valida el payload de alta. Lanza BadRequestError (400) si es inválido. */
  validateCreate(body: CreatePlanInput): ValidatedPlan {
    const nameMissing =
      body.name === undefined || body.name === null || String(body.name).trim() === '';
    if (
      nameMissing ||
      body.speedMbpsDown === undefined ||
      body.speedMbpsUp === undefined ||
      body.price === undefined ||
      !body.type
    ) {
      throw new BadRequestError(
        'Missing required fields: name, speedMbpsDown, speedMbpsUp, price, type',
        'MISSING_FIELD',
      );
    }

    const speedMbpsDown = this.parseNonNegativeNumber(body.speedMbpsDown, 'speedMbpsDown');
    const speedMbpsUp = this.parseNonNegativeNumber(body.speedMbpsUp, 'speedMbpsUp');
    const price = this.parseNonNegativeNumber(body.price, 'price');

    const type = parsePlanTechType(body.type);
    if (!type) {
      throw new BadRequestError('Invalid plan type', 'INVALID_ENUM');
    }

    return {
      name: String(body.name).trim(),
      speedMbpsDown,
      speedMbpsUp,
      price,
      type,
      businessType: asBusinessType(body.businessType),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    };
  }

  /**
   * Valida y construye el patch de edición: solo las claves presentes,
   * ya coercionadas. Lanza BadRequestError (400) ante valores inválidos.
   */
  buildUpdatePatch(body: Record<string, unknown>): Partial<PlanRecord> {
    const patch: Partial<PlanRecord> = {};

    if (body.name !== undefined) {
      if (String(body.name).trim() === '') {
        throw new BadRequestError('Invalid plan name: must not be empty', 'MISSING_FIELD');
      }
      patch.name = String(body.name).trim();
    }
    if (body.speedMbpsDown !== undefined) {
      patch.speedMbpsDown = this.parseNonNegativeNumber(body.speedMbpsDown, 'speedMbpsDown');
    }
    if (body.speedMbpsUp !== undefined) {
      patch.speedMbpsUp = this.parseNonNegativeNumber(body.speedMbpsUp, 'speedMbpsUp');
    }
    if (body.price !== undefined) {
      patch.price = this.parseNonNegativeNumber(body.price, 'price');
    }
    if (body.type !== undefined) {
      const type = parsePlanTechType(body.type);
      if (!type) {
        throw new BadRequestError('Invalid plan type', 'INVALID_ENUM');
      }
      patch.type = type;
    }
    if (body.businessType !== undefined) {
      patch.businessType = asBusinessType(body.businessType);
    }
    if (body.isActive !== undefined) {
      patch.isActive = Boolean(body.isActive);
    }

    return patch;
  }

  /** Lanza ConflictError (409) si ya existe un plan con ese nombre. */
  async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.repo.findByName(name);
    if (existing) {
      throw new ConflictError('Plan name already exists', 'DUPLICATE_NAME');
    }
  }

  // --- Operaciones (delegan al repository) ---------------------------
  list(filters: PlanFilters): Promise<PlanRecord[]> {
    return this.repo.list(filters);
  }

  getById(id: string): Promise<PlanRecord | null> {
    return this.repo.findById(id);
  }

  generatePlanId(): Promise<string> {
    return this.repo.generateId();
  }

  create(plan: PlanRecord): Promise<PlanRecord> {
    return this.repo.create(plan);
  }

  update(id: string, patch: Partial<PlanRecord>): Promise<PlanRecord | null> {
    return this.repo.update(id, patch);
  }

  remove(id: string): Promise<boolean> {
    return this.repo.remove(id);
  }

  isInUse(id: string): Promise<boolean> {
    return this.repo.isInUse(id);
  }
}

// --------------------------------------------------------------------
// Factoría: elige el repository según el feature flag (singleton).
// Falla rápido y claro si se pide modo DB sin Supabase configurado.
// --------------------------------------------------------------------
let singleton: PlansService | null = null;

const buildService = (): PlansService => {
  if (isDomainOnDb('plans')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error(
        'USE_DB_PLANS=true pero Supabase no está configurado. ' +
          'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, o vuelve a USE_DB_PLANS=false.',
      );
    }
    logger.info('Plans domain: persistencia = Supabase (USE_DB_PLANS=true)');
    return new PlansService(new SupabasePlansRepository(supabaseAdmin));
  }
  logger.info('Plans domain: persistencia = store en memoria (USE_DB_PLANS=false)');
  return new PlansService(new StorePlansRepository());
};

export const getPlansService = (): PlansService => {
  if (!singleton) singleton = buildService();
  return singleton;
};

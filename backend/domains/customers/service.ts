// ====================================================================
// Service del dominio Customers.
//
// Concentra reglas de negocio y validaciones del cliente, y delega la
// persistencia al repository (store mock o Supabase, según USE_DB_CUSTOMERS).
// No conoce Express (sin req/res): es lógica pura y testeable.
//
// IMPORTANTE (alcance del piloto): este service maneja la ENTIDAD cliente
// y su timeline. Los efectos cruzados de "conversión de lead" (factura/ONU,
// logs MikroTik, alertas) viven en otros dominios aún NO migrados y siguen
// operando contra el store desde routes.ts, en ambos modos.
// ====================================================================

import { Client } from '../../../src/types';
import { ClientTimelineEvent } from '../../state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { BadRequestError } from '../../common/errors';
import { logger } from '../../common/logger';
import {
  CustomerFilters,
  CustomersRepository,
  StoreCustomersRepository,
  SupabaseCustomersRepository,
} from './repository';

const CLIENT_TYPES: Client['type'][] = ['residential', 'corporate', 'government', 'hotel', 'school'];
const CLIENT_STATUSES: Client['status'][] = ['active', 'suspended', 'lead', 'baja'];

export const parseClientType = (value: unknown): Client['type'] | null => {
  const type = String(value || '').trim().toLowerCase();
  return (CLIENT_TYPES as string[]).includes(type) ? (type as Client['type']) : null;
};

export const parseClientStatus = (value: unknown): Client['status'] | null => {
  const status = String(value || '').trim().toLowerCase();
  return (CLIENT_STATUSES as string[]).includes(status) ? (status as Client['status']) : null;
};

export interface CreateClientInput {
  name?: unknown;
  type?: unknown;
  address?: unknown;
  city?: unknown;
  email?: unknown;
}

export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  // --- Validaciones --------------------------------------------------
  /** Valida el payload de alta. Lanza BadRequestError (400) si es inválido. */
  validateCreate(body: CreateClientInput): { type: Client['type'] } {
    if (!body.name || !body.type || !body.address || !body.city) {
      throw new BadRequestError('Missing required fields: name, type, address, city', 'MISSING_FIELD');
    }
    const type = parseClientType(body.type);
    if (!type) {
      throw new BadRequestError('Invalid client type', 'INVALID_ENUM');
    }
    if (body.email !== undefined && body.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) {
      throw new BadRequestError('Invalid email', 'INVALID_EMAIL');
    }
    return { type };
  }

  /** Valida el payload de edición. Lanza BadRequestError (400) si trae enums inválidos. */
  validateUpdate(body: Record<string, unknown>): void {
    if (body.status !== undefined && parseClientStatus(body.status) === null) {
      throw new BadRequestError('Invalid client status', 'INVALID_ENUM');
    }
    if (body.type !== undefined && parseClientType(body.type) === null) {
      throw new BadRequestError('Invalid client type', 'INVALID_ENUM');
    }
    if (body.email !== undefined && body.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) {
      throw new BadRequestError('Invalid email', 'INVALID_EMAIL');
    }
  }

  // --- Operaciones (delegan al repository) ---------------------------
  list(filters: CustomerFilters): Promise<Client[]> {
    return this.repo.list(filters);
  }

  getById(id: string): Promise<Client | null> {
    return this.repo.findById(id);
  }

  getHistory(id: string): Promise<ClientTimelineEvent[]> {
    return this.repo.listTimeline(id);
  }

  generateClientId(): Promise<string> {
    return this.repo.generateId();
  }

  create(client: Client): Promise<Client> {
    return this.repo.create(client);
  }

  update(id: string, patch: Partial<Client>): Promise<Client | null> {
    return this.repo.update(id, patch);
  }

  remove(id: string): Promise<boolean> {
    return this.repo.remove(id);
  }

  addTimelineEvent(event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>): Promise<void> {
    return this.repo.addTimelineEvent(event);
  }
}

// --------------------------------------------------------------------
// Factoría: elige el repository según el feature flag (singleton).
// Falla rápido y claro si se pide modo DB sin Supabase configurado.
// --------------------------------------------------------------------
let singleton: CustomersService | null = null;

const buildService = (): CustomersService => {
  if (isDomainOnDb('customers')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error(
        'USE_DB_CUSTOMERS=true pero Supabase no está configurado. ' +
          'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, o vuelve a USE_DB_CUSTOMERS=false.',
      );
    }
    logger.info('Customers domain: persistencia = Supabase (USE_DB_CUSTOMERS=true)');
    return new CustomersService(new SupabaseCustomersRepository(supabaseAdmin));
  }
  logger.info('Customers domain: persistencia = store en memoria (USE_DB_CUSTOMERS=false)');
  return new CustomersService(new StoreCustomersRepository());
};

export const getCustomersService = (): CustomersService => {
  if (!singleton) singleton = buildService();
  return singleton;
};

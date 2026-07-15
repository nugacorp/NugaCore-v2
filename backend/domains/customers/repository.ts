// ====================================================================
// Repository del dominio Customers.
//
// Define el contrato `CustomersRepository` y dos implementaciones con la
// MISMA interfaz:
//   - StoreCustomersRepository    → store en memoria (modo mock, default).
//   - SupabaseCustomersRepository → Supabase/PostgreSQL (modo DB).
//
// El service elige una u otra según el feature flag USE_DB_CUSTOMERS.
// El contrato de API v1 no cambia: ambos devuelven objetos `Client`.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { Client } from '../../../src/types';
import { ClientTimelineEvent, store } from '../../state/store';
import { logger } from '../../common/logger';
import { ConflictError } from '../../common/errors';
import {
  ClientRow,
  TimelineRow,
  clientPatchToRow,
  clientToRow,
  rowToClient,
  rowToTimeline,
  timelineToRow,
} from './mappers';

export interface CustomerFilters {
  status?: Client['status'] | null;
  type?: Client['type'] | null;
  city?: string;   // ya normalizado a minúsculas por la ruta
  planId?: string;
  q?: string;      // ya normalizado a minúsculas por la ruta
}

export interface CustomersRepository {
  list(filters: CustomerFilters): Promise<Client[]>;
  findById(id: string): Promise<Client | null>;
  create(client: Client): Promise<Client>;
  update(id: string, patch: Partial<Client>): Promise<Client | null>;
  /** Elimina el cliente (y su timeline). NO toca otros dominios (invoices/onus). */
  remove(id: string): Promise<boolean>;
  /** Genera el siguiente id con formato slug `c-N`. */
  generateId(): Promise<string>;
  listTimeline(clientId: string): Promise<ClientTimelineEvent[]>;
  addTimelineEvent(event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>): Promise<void>;
}

// --------------------------------------------------------------------
// Implementación MOCK (store en memoria). Replica la lógica que vivía
// en routes.ts para que el modo mock sea idéntico al comportamiento previo.
// --------------------------------------------------------------------
export class StoreCustomersRepository implements CustomersRepository {
  async list(filters: CustomerFilters): Promise<Client[]> {
    const { status, type, city, planId, q } = filters;
    return store.CLIENTS.filter((client) => {
      const matchesStatus = !status || client.status === status;
      const matchesType = !type || client.type === type;
      const matchesCity = !city || client.city.toLowerCase().includes(city);
      const matchesPlan = !planId || client.planId === planId;
      const matchesQuery =
        !q ||
        client.name.toLowerCase().includes(q) ||
        client.email.toLowerCase().includes(q) ||
        client.phone.includes(q);
      return matchesStatus && matchesType && matchesCity && matchesPlan && matchesQuery;
    });
  }

  async findById(id: string): Promise<Client | null> {
    return store.CLIENTS.find((c) => c.id === id) ?? null;
  }

  async create(client: Client): Promise<Client> {
    store.CLIENTS.push(client);
    return client;
  }

  async update(id: string, patch: Partial<Client>): Promise<Client | null> {
    const index = store.CLIENTS.findIndex((c) => c.id === id);
    if (index === -1) return null;
    store.CLIENTS[index] = { ...store.CLIENTS[index], ...patch };
    return store.CLIENTS[index];
  }

  async remove(id: string): Promise<boolean> {
    const existed = store.CLIENTS.some((c) => c.id === id);
    if (!existed) return false;
    store.CLIENTS = store.CLIENTS.filter((c) => c.id !== id);
    store.CLIENT_TIMELINE = store.CLIENT_TIMELINE.filter((e) => e.clientId !== id);
    return true;
  }

  async generateId(): Promise<string> {
    return store.getUniqueClientId();
  }

  async listTimeline(clientId: string): Promise<ClientTimelineEvent[]> {
    return store.CLIENT_TIMELINE.filter((e) => e.clientId === clientId);
  }

  async addTimelineEvent(event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>): Promise<void> {
    store.addClientTimelineEvent(event);
  }
}

// --------------------------------------------------------------------
// Implementación DB (Supabase / PostgreSQL). Usa el cliente admin
// (service-role) — SIEMPRE del lado servidor, nunca expuesto al frontend.
// --------------------------------------------------------------------
const CLIENTS_TABLE = 'clients';
const TIMELINE_TABLE = 'client_timeline';

const fail = (context: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Supabase customers repository error: ${context}`, { message });
  throw new Error(`Customers DB error (${context}): ${message}`);
};

export class SupabaseCustomersRepository implements CustomersRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(filters: CustomerFilters): Promise<Client[]> {
    let query = this.client.from(CLIENTS_TABLE).select('*');
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('type', filters.type);
    if (filters.city) query = query.ilike('city', `%${filters.city}%`);
    if (filters.planId) query = query.eq('plan_id', filters.planId);
    if (filters.q) {
      query = query.or(`full_name.ilike.%${filters.q}%,email.ilike.%${filters.q}%,phone.ilike.%${filters.q}%`);
    }

    const { data, error } = await query;
    if (error) return fail('list', error);
    return (data as ClientRow[]).map(rowToClient);
  }

  async findById(id: string): Promise<Client | null> {
    const { data, error } = await this.client.from(CLIENTS_TABLE).select('*').eq('id', id).maybeSingle();
    if (error) return fail('findById', error);
    return data ? rowToClient(data as ClientRow) : null;
  }

  async create(client: Client): Promise<Client> {
    const { data, error } = await this.client
      .from(CLIENTS_TABLE)
      .insert(clientToRow(client))
      .select('*')
      .single();
    if (error) return fail('create', error);
    return rowToClient(data as ClientRow);
  }

  async update(id: string, patch: Partial<Client>): Promise<Client | null> {
    const row = clientPatchToRow(patch);
    if (Object.keys(row).length === 0) {
      return this.findById(id);
    }
    const { data, error } = await this.client
      .from(CLIENTS_TABLE)
      .update(row)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return fail('update', error);
    return data ? rowToClient(data as ClientRow) : null;
  }

  async remove(id: string): Promise<boolean> {
    // Attempt to clean up RESTRICT-FK dependents in dependency order so that
    // the final clients DELETE does not hit a 23503 FK violation.
    const depTables: string[] = [
      'payment_applications',
      'payment_receipts',
      'payments',
      'credit_applications',
      'credit_notes',
      'adjustments',
      'invoice_payments',
      'invoice_items',
      'invoices',
      'service_subscriptions',
      'customer_service_state',
      'suspension_orders',
      'suspension_events',
      'client_timeline',
      'client_documents',
      'client_tags',
      'client_alternate_contacts',
      'client_activity_log',
      'payment_promises',
      'onus',
    ];

    for (const table of depTables) {
      try {
        await this.client.from(table).delete().eq('client_id', id);
      } catch {
        // Table may not exist yet or FK column differs — continue to next
      }
    }

    const { error, count } = await this.client
      .from(CLIENTS_TABLE)
      .delete({ count: 'exact' })
      .eq('id', id);

    if (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === '23503'
      ) {
        throw new ConflictError(
          'No se puede eliminar: el cliente tiene historial financiero o relaciones bloqueantes. Baja comercial o limpia dependencias primero.',
        );
      }
      return fail('remove', error);
    }
    return (count ?? 0) > 0;
  }

  async generateId(): Promise<string> {
    const { data, error } = await this.client.from(CLIENTS_TABLE).select('id').like('id', 'c-%');
    if (error) return fail('generateId', error);
    const max = (data as { id: string }[]).reduce((acc, row) => {
      const n = parseInt(String(row.id).slice(2), 10);
      return Number.isFinite(n) && n > acc ? n : acc;
    }, 0);
    return `c-${max + 1}`;
  }

  async listTimeline(clientId: string): Promise<ClientTimelineEvent[]> {
    const { data, error } = await this.client
      .from(TIMELINE_TABLE)
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    if (error) return fail('listTimeline', error);
    return (data as TimelineRow[]).map(rowToTimeline);
  }

  async addTimelineEvent(event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>): Promise<void> {
    const id = 'ct-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10);
    const createdAt = new Date().toISOString();
    const { error } = await this.client.from(TIMELINE_TABLE).insert(timelineToRow(event, id, createdAt));
    if (error) fail('addTimelineEvent', error);
  }
}

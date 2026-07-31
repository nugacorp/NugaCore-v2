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
  /** Aislamiento multi-tenant; si se omite no se filtra (compat single-WISP). */
  tenantId?: string;
}

export interface CustomersRepository {
  list(filters: CustomerFilters): Promise<Client[]>;
  findById(id: string, tenantId?: string): Promise<Client | null>;
  create(client: Client): Promise<Client>;
  update(id: string, patch: Partial<Client>, tenantId?: string): Promise<Client | null>;
  /** Elimina el cliente (y su timeline). NO toca otros dominios (invoices/onus). */
  remove(id: string, tenantId?: string): Promise<boolean>;
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
    const { status, type, city, planId, q, tenantId } = filters;
    return store.CLIENTS.filter((client) => {
      const matchesTenant =
        !tenantId
        || (client.tenantId || 'tenant-default') === tenantId;
      const matchesStatus = !status || client.status === status;
      const matchesType = !type || client.type === type;
      const matchesCity = !city || client.city.toLowerCase().includes(city);
      const matchesPlan = !planId || client.planId === planId;
      const matchesQuery =
        !q ||
        client.name.toLowerCase().includes(q) ||
        client.email.toLowerCase().includes(q) ||
        client.phone.includes(q);
      return matchesTenant && matchesStatus && matchesType && matchesCity && matchesPlan && matchesQuery;
    });
  }

  async findById(id: string, tenantId?: string): Promise<Client | null> {
    const client = store.CLIENTS.find((c) => c.id === id) ?? null;
    if (!client || !tenantId) return client;
    return (client.tenantId || 'tenant-default') === tenantId ? client : null;
  }

  async create(client: Client): Promise<Client> {
    store.CLIENTS.push(client);
    return client;
  }

  async update(id: string, patch: Partial<Client>, tenantId?: string): Promise<Client | null> {
    const index = store.CLIENTS.findIndex((c) => {
      if (c.id !== id) return false;
      if (!tenantId) return true;
      return (c.tenantId || 'tenant-default') === tenantId;
    });
    if (index === -1) return null;
    store.CLIENTS[index] = { ...store.CLIENTS[index], ...patch };
    return store.CLIENTS[index];
  }

  async remove(id: string, tenantId?: string): Promise<boolean> {
    const existed = store.CLIENTS.some((c) => {
      if (c.id !== id) return false;
      if (!tenantId) return true;
      return (c.tenantId || 'tenant-default') === tenantId;
    });
    if (!existed) return false;
    store.CLIENTS = store.CLIENTS.filter((c) => {
      if (c.id !== id) return true;
      if (!tenantId) return false;
      return (c.tenantId || 'tenant-default') !== tenantId;
    });
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
    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
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

  async findById(id: string, tenantId?: string): Promise<Client | null> {
    let query = this.client.from(CLIENTS_TABLE).select('*').eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.maybeSingle();
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

  async update(id: string, patch: Partial<Client>, tenantId?: string): Promise<Client | null> {
    const row = clientPatchToRow(patch);
    if (Object.keys(row).length === 0) {
      return this.findById(id, tenantId);
    }
    let query = this.client.from(CLIENTS_TABLE).update(row).eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) return fail('update', error);
    return data ? rowToClient(data as ClientRow) : null;
  }

  async remove(id: string, tenantId?: string): Promise<boolean> {
    // Supabase JS no lanza en errores PostgREST: hay que leer `{ error }`.
    // Varias tablas RESTRICT (payments, credit_notes, …) y otras usan
    // `customer_id` (suspensión). payment_applications NO tiene client_id.
    if (tenantId) {
      const owned = await this.findById(id, tenantId);
      if (!owned) return false;
    }

    const warn = (table: string, error: { code?: string; message?: string } | null) => {
      if (!error) return;
      logger.warn('customers.remove dep cleanup', {
        table,
        code: error.code,
        message: error.message,
      });
    };

    const delEq = async (table: string, column: string, value: string) => {
      const { error } = await this.client.from(table).delete().eq(column, value);
      warn(table, error);
    };

    const delIn = async (table: string, column: string, values: string[]) => {
      if (values.length === 0) return;
      const { error } = await this.client.from(table).delete().in(column, values);
      warn(table, error);
    };

    const { data: invoiceRows, error: invErr } = await this.client
      .from('invoices')
      .select('id')
      .eq('client_id', id);
    warn('invoices.select', invErr);
    const invoiceIds = (invoiceRows ?? []).map((r) => String((r as { id: string }).id));

    const { data: paymentRows, error: payErr } = await this.client
      .from('payments')
      .select('id')
      .eq('client_id', id);
    warn('payments.select', payErr);
    const paymentIds = (paymentRows ?? []).map((r) => String((r as { id: string }).id));

    const { data: creditRows, error: cnErr } = await this.client
      .from('credit_notes')
      .select('id')
      .eq('client_id', id);
    warn('credit_notes.select', cnErr);
    const creditNoteIds = (creditRows ?? []).map((r) => String((r as { id: string }).id));

    // Hijos M:N primero (sin client_id directo)
    await delIn('payment_applications', 'payment_id', paymentIds);
    await delIn('payment_applications', 'invoice_id', invoiceIds);
    await delIn('payment_receipts', 'payment_id', paymentIds);
    await delIn('credit_applications', 'credit_note_id', creditNoteIds);
    await delIn('credit_applications', 'invoice_id', invoiceIds);
    await delIn('adjustments', 'invoice_id', invoiceIds);
    await delEq('adjustments', 'client_id', id);
    await delIn('invoice_payments', 'invoice_id', invoiceIds);
    await delIn('invoice_items', 'invoice_id', invoiceIds);

    // Entidades con client_id RESTRICT
    await delEq('payment_receipts', 'client_id', id);
    await delEq('payments', 'client_id', id);
    await delEq('credit_notes', 'client_id', id);
    await delIn('invoices', 'id', invoiceIds);
    await delEq('invoices', 'client_id', id);

    // Suspensión / estado de servicio usan customer_id
    await delEq('reactivation_orders', 'customer_id', id);
    await delEq('suspension_orders', 'customer_id', id);
    await delEq('suspension_events', 'customer_id', id);
    await delEq('customer_service_state', 'customer_id', id);

    // Relacionadas tipicas (CASCADE o SET NULL; limpiar por robustez)
    const clientIdTables = [
      'service_subscriptions',
      'client_timeline',
      'client_documents',
      'client_tags',
      'client_alternate_contacts',
      'client_activity_log',
      'payment_promises',
      'portal_user_bindings',
      'onus',
      'tickets',
      'work_orders',
    ];
    for (const table of clientIdTables) {
      await delEq(table, 'client_id', id);
    }

    let deleteQuery = this.client
      .from(CLIENTS_TABLE)
      .delete({ count: 'exact' })
      .eq('id', id);
    if (tenantId) deleteQuery = deleteQuery.eq('tenant_id', tenantId);
    const { error, count } = await deleteQuery;

    if (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === '23503'
      ) {
        throw new ConflictError(
          'No se puede eliminar: el cliente tiene historial financiero o relaciones bloqueantes. Usa Baja comercial o limpia dependencias primero.',
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

    const { data: clientRow, error: clientError } = await this.client
      .from(CLIENTS_TABLE)
      .select('tenant_id')
      .eq('id', event.clientId)
      .maybeSingle();

    if (clientError) return fail('addTimelineEvent:resolveTenant', clientError);

    // Fail-closed: sin tenant legible NO se escribe. Un fallback a
    // 'tenant-default' aquí sellaría el evento en el WISP equivocado y sería
    // el mismo patrón fail-open que PR-1B debe eliminar de tenant-scope.
    const tenantId = (clientRow as { tenant_id?: string | null } | null)?.tenant_id?.trim();
    if (!tenantId) {
      return fail(
        'addTimelineEvent:resolveTenant',
        new Error(`Cliente ${event.clientId} sin tenant_id resoluble; no se escribe el evento`),
      );
    }

    const { error } = await this.client
      .from(TIMELINE_TABLE)
      .insert(timelineToRow(event, id, createdAt, tenantId));
    if (error) fail('addTimelineEvent', error);
  }
}

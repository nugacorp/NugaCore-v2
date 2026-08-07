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
import {
  ConflictError,
  IdempotencyConflictError,
  IdempotencyResolutionError,
} from '../../common/errors';
import { tenantScopedIdempotencyId } from '../../common/idempotency';
import { redactStoragePath } from '../../common/log-redaction';
import { removeDocumentObject } from '../../services/supabase-storage';
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
  addTimelineEvent(
    event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>,
    options?: TimelineWriteOptions,
  ): Promise<void>;
}

/**
 * Identidad durable opcional (T5). Sin ella el método conserva exactamente el
 * comportamiento histórico: cada llamada crea una entrada. Con ella, el
 * reintento de otro owner recupera la entrada existente en vez de duplicarla.
 */
export interface TimelineWriteOptions {
  tenantId?: string;
  idempotencyKey?: string;
}

export const TIMELINE_IDEMPOTENCY_SCOPE = 'client_timeline';

const isUniqueViolation = (error: { code?: string; message?: string }): boolean =>
  String(error?.code) === '23505' || /duplicate key|already exists/i.test(String(error?.message ?? ''));

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

  async addTimelineEvent(
    event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>,
    options?: TimelineWriteOptions,
  ): Promise<void> {
    if (!options?.idempotencyKey) {
      store.addClientTimelineEvent(event);
      return;
    }
    const tenantId = options.tenantId || 'tenant-default';
    // Sin `await` entre la búsqueda y la escritura: create-or-return atómico.
    const existing = store.CLIENT_TIMELINE.find(
      (row) =>
        (row.tenantId || 'tenant-default') === tenantId
        && row.idempotencyKey === options.idempotencyKey,
    );
    if (existing) {
      if (
        existing.clientId !== event.clientId
        || existing.eventType !== event.eventType
        || existing.summary !== event.summary
        || (existing.details ?? null) !== (event.details ?? null)
        || (existing.createdBy ?? null) !== (event.createdBy ?? null)
      ) {
        throw new IdempotencyConflictError(TIMELINE_IDEMPOTENCY_SCOPE, options.idempotencyKey);
      }
      return;
    }
    store.addClientTimelineEvent({ ...event, tenantId, idempotencyKey: options.idempotencyKey });
  }
}

// --------------------------------------------------------------------
// Implementación DB (Supabase / PostgreSQL). Usa el cliente admin
// (service-role) — SIEMPRE del lado servidor, nunca expuesto al frontend.
// --------------------------------------------------------------------
const CLIENTS_TABLE = 'clients';
const TIMELINE_TABLE = 'client_timeline';

/**
 * Un `PostgrestError` es un objeto plano, NO un `Error`: `String(error)` lo
 * convierte en `[object Object]` y el diagnóstico se pierde entero. Importa
 * más desde que `remove()` va por RPC, porque ya no deja rastro tabla a tabla:
 * este log es la única traza de cualquier fallo no traducido.
 */
const describeDbError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [
      typeof e.message === 'string' ? e.message : null,
      typeof e.code === 'string' ? `code=${e.code}` : null,
      typeof e.details === 'string' && e.details ? `details=${e.details}` : null,
      typeof e.hint === 'string' && e.hint ? `hint=${e.hint}` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' · ');
  }
  return String(error);
};

const fail = (context: string, error: unknown): never => {
  const message = describeDbError(error);
  logger.error(`Supabase customers repository error: ${context}`, { message });
  throw new Error(`Customers DB error (${context}): ${message}`);
};

// --------------------------------------------------------------------
// Borrado de cliente: traducción del bloqueo y barrido del bucket.
// --------------------------------------------------------------------

/** 23503: violación de clave foránea. Llega como objeto plano, no como Error. */
const isForeignKeyViolation = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === '23503' || (typeof message === 'string' && message.includes('23503'));
};

/** Tablas que bloquean el borrado → cómo llamarlas delante de un usuario. */
const BLOCKING_LABELS: Record<string, [string, string]> = {
  payments: ['pago registrado', 'pagos registrados'],
  payment_receipts: ['comprobante de pago', 'comprobantes de pago'],
  credit_notes: ['nota de crédito', 'notas de crédito'],
  adjustments: ['ajuste de facturación', 'ajustes de facturación'],
  payment_applications: ['pago aplicado a facturas', 'pagos aplicados a facturas'],
  credit_applications: ['nota de crédito aplicada', 'notas de crédito aplicadas'],
};

const SALIDA = 'Usa la Baja comercial para desactivarlo conservando su historial.';

/**
 * `customers_delete_cascade: client_delete_blocked: {"payments":2,...}` → el
 * mensaje que ve el usuario. La RPC dice QUÉ bloquea y con cuántas filas, así
 * que el conflicto puede ser concreto en vez de genérico, y ofrece la salida
 * que el producto ya tiene: la baja comercial.
 */
export const clientDeleteBlockedMessage = (rpcMessage: string): string => {
  const detail = (() => {
    const start = rpcMessage.indexOf('{');
    if (start < 0) return '';
    try {
      const counts = JSON.parse(rpcMessage.slice(start)) as Record<string, unknown>;
      return Object.entries(counts)
        .filter(([, n]) => typeof n === 'number' && n > 0)
        .map(([table, n]) => {
          const count = n as number;
          const label = BLOCKING_LABELS[table] ?? [table, table];
          return `${count} ${count === 1 ? label[0] : label[1]}`;
        })
        .join(', ');
    } catch {
      // La RPC cambió de forma: mejor un mensaje genérico que uno inventado.
      return '';
    }
  })();

  return (
    'No se puede eliminar: el cliente tiene historial financiero con obligación de conservación'
    + (detail ? ` (${detail})` : '')
    + `. ${SALIDA}`
  );
};

/** Rutas de Storage devueltas por la RPC, saneadas. */
const storagePathsOf = (raw: Record<string, unknown> | null): string[] => {
  const paths = raw?.storage_paths;
  if (!Array.isArray(paths)) return [];
  return paths.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
};

/**
 * Barrido best-effort de los objetos del bucket, DESPUÉS del commit.
 *
 * Nunca lanza: el cliente ya está borrado y la transacción confirmada. Fallar
 * aquí le diría al llamador que el borrado no ocurrió, cuando sí ocurrió. Lo
 * que queda si esto falla son objetos huérfanos —basura recuperable— y una
 * traza con lo justo para localizarlos: el cliente y la carpeta, nunca el
 * nombre del archivo, que es dato personal.
 */
const sweepDocumentObjects = async (clientId: string, paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  try {
    const orphaned: string[] = [];
    for (const path of paths) {
      if (!(await removeDocumentObject(path))) orphaned.push(redactStoragePath(path));
    }
    if (orphaned.length > 0) {
      logger.warn('customers.remove: objetos huérfanos en el bucket', {
        clientId,
        orphaned: orphaned.length,
        total: paths.length,
        prefixes: [...new Set(orphaned)],
      });
    }
  } catch (error) {
    logger.warn('customers.remove: el barrido del bucket falló entero', {
      clientId,
      total: paths.length,
      message: error instanceof Error ? error.message : String(error),
    });
  }
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
    // Una sola transacción Postgres: comprueba los bloqueantes ANTES de tocar
    // nada, borra y desliga según declara el esquema, y devuelve los
    // `storage_path` de los documentos que se llevó por delante.
    //
    // NO hay fallback al borrado multi-write que había aquí. Si la RPC no está,
    // esto falla cerrado: volver a borrar ~25 tablas una a una, sin transacción
    // y tragándose los errores, reintroduciría el defecto justo cuando más
    // falta hace —el cliente sobrevivía con su historial financiero destruido.
    const { data, error } = await this.client.rpc('customers_delete_cascade', {
      p_client_id: id,
      p_tenant_id: tenantId ?? null,
    });

    if (error) {
      const message = error.message ?? '';
      // La RPC no distingue "no existe" de "es de otro tenant", a propósito:
      // así no filtra la existencia de clientes ajenos. Ambos son 404, igual
      // que antes.
      if (/client_not_found/i.test(message)) return false;
      if (/client_delete_blocked/i.test(message)) {
        throw new ConflictError(clientDeleteBlockedMessage(message));
      }
      // Cinturón: una violación de clave foránea que el pre-check no vio.
      // Bajo READ COMMITTED puede pasar —un INSERT sin confirmar sobre una
      // factura del cliente es invisible al contarlo, y el `FOR UPDATE` sobre
      // `clients` no lo serializa porque esa tabla no cuelga de `clients`— y
      // también taparía cualquier tabla que se escape del cierre de la
      // cascada. El usuario merece el 409 con la salida a Baja comercial, no
      // un 500. La transacción ya revirtió: no se ha perdido nada.
      if (isForeignKeyViolation(error)) {
        logger.warn('customers.remove: bloqueo no previsto por el pre-check', {
          clientId: id,
          message: describeDbError(error),
        });
        throw new ConflictError(clientDeleteBlockedMessage(''));
      }
      return fail('remove', error);
    }

    // ── POST-COMMIT, y sólo aquí ──────────────────────────────────────
    // El orden es el diseño: la transacción ya confirmó, así que los objetos
    // que se barren no tienen ninguna fila que los nombre. Al revés —barrer
    // antes— un rollback dejaría filas apuntando a bytes inexistentes, que es
    // corrupción; en este orden el peor caso son huérfanos, basura recuperable.
    const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    await sweepDocumentObjects(id, storagePathsOf(raw));
    return true;
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

  async addTimelineEvent(
    event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>,
    options?: TimelineWriteOptions,
  ): Promise<void> {
    const createdAt = new Date().toISOString();
    if (!options?.idempotencyKey) {
      const id = 'ct-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10);
      const { error } = await this.client.from(TIMELINE_TABLE).insert(timelineToRow(event, id, createdAt));
      if (error) fail('addTimelineEvent', error);
      return;
    }

    const tenantId = options.tenantId || 'tenant-default';
    const row = {
      ...timelineToRow(
        event,
        tenantScopedIdempotencyId('ct', tenantId, options.idempotencyKey),
        createdAt,
      ),
      tenant_id: tenantId,
      idempotency_key: options.idempotencyKey,
    };
    const { error } = await this.client.from(TIMELINE_TABLE).insert(row);
    if (!error) return;
    if (!isUniqueViolation(error)) fail('addTimelineEvent', error);

    const { data, error: readError } = await this.client
      .from(TIMELINE_TABLE).select('id, client_id, event_type, summary, details, created_by')
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', options.idempotencyKey)
      .maybeSingle();
    if (readError) fail('addTimelineEvent(read)', readError);
    if (!data) {
      throw new IdempotencyResolutionError(TIMELINE_IDEMPOTENCY_SCOPE, options.idempotencyKey);
    }
    if (
      data!.client_id !== event.clientId
      || data!.event_type !== event.eventType
      || data!.summary !== event.summary
      || (data!.details ?? null) !== (event.details ?? null)
      || (data!.created_by ?? null) !== (event.createdBy ?? null)
    ) {
      throw new IdempotencyConflictError(TIMELINE_IDEMPOTENCY_SCOPE, options.idempotencyKey);
    }
  }
}

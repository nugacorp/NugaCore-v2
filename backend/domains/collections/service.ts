import { isDomainOnDb } from '../../config/feature-flags';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { collectionsMemory, uid, today, stamp, type CashRegisterEntry, type PaymentPromise } from './memory-store';

export class CollectionsService {
  private useDb = isDomainOnDb('billing') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase admin client not configured');
    return supabaseAdmin;
  }

  listPromises(filters?: { clientId?: string; status?: string }) {
    const rows = collectionsMemory.promises.filter((p) => {
      const matchClient = !filters?.clientId || p.clientId === filters.clientId;
      const matchStatus = !filters?.status || p.status === filters.status;
      return matchClient && matchStatus;
    });
    if (this.useDb) {
      return this.admin.from('payment_promises').select('*').then(({ data, error }) => {
        if (error) throw error;
        let list = (data ?? []).map(this.rowToPromise);
        if (filters?.clientId) list = list.filter((p) => p.clientId === filters.clientId);
        if (filters?.status) list = list.filter((p) => p.status === filters.status);
        return list;
      });
    }
    return Promise.resolve(rows);
  }

  async createPromise(body: Record<string, unknown>, createdBy?: string) {
    const clientId = String(body.clientId || '').trim();
    const promisedDate = String(body.promisedDate || '').trim();
    if (!clientId || !promisedDate) throw new BadRequestError('clientId and promisedDate required', 'MISSING_FIELD');
    const promise: PaymentPromise = {
      id: uid('pp'),
      clientId,
      promisedDate,
      amountCents: Math.round(Number(body.amountCents ?? (Number(body.amount ?? 0) * 100))),
      currency: String(body.currency || 'MXN'),
      status: 'active',
      blocksSuspension: body.blocksSuspension !== false,
      notes: body.notes ? String(body.notes) : undefined,
      createdBy,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('payment_promises').insert(this.promiseToRow(promise));
      if (error) throw error;
    } else {
      collectionsMemory.promises.unshift(promise);
    }
    return promise;
  }

  async fulfillPromise(id: string) {
    const p = collectionsMemory.promises.find((x) => x.id === id);
    if (!this.useDb && !p) throw new NotFoundError('Promise not found', 'NOT_FOUND');
    if (this.useDb) {
      const { data, error } = await this.admin.from('payment_promises').update({ status: 'fulfilled', updated_at: stamp() }).eq('id', id).select('*').maybeSingle();
      if (error) throw error;
      if (!data) throw new NotFoundError('Promise not found', 'NOT_FOUND');
      return this.rowToPromise(data);
    }
    if (p) { p.status = 'fulfilled'; p.updatedAt = stamp(); }
    return p!;
  }

  listCashEntries(filters?: { date?: string; collectorId?: string }) {
    const date = filters?.date ?? today();
    const rows = collectionsMemory.cashEntries.filter((e) => {
      const matchDate = e.entryDate === date;
      const matchCollector = !filters?.collectorId || e.collectorId === filters.collectorId;
      return matchDate && matchCollector;
    });
    if (this.useDb) {
      let q = this.admin.from('cash_register_entries').select('*').eq('entry_date', date);
      if (filters?.collectorId) q = q.eq('collector_id', filters.collectorId);
      return q.order('created_at', { ascending: false }).then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []).map(this.rowToCash);
      });
    }
    return Promise.resolve(rows);
  }

  async addCashEntry(body: Record<string, unknown>, collector?: { id?: string; name?: string }) {
    const amountCents = Math.round(Number(body.amountCents ?? (Number(body.amount ?? 0) * 100)));
    if (amountCents <= 0) throw new BadRequestError('positive amount required', 'MISSING_FIELD');
    const entry: CashRegisterEntry = {
      id: uid('cash'),
      collectorId: collector?.id,
      collectorName: collector?.name ?? (body.collectorName ? String(body.collectorName) : undefined),
      clientId: body.clientId ? String(body.clientId) : undefined,
      invoiceId: body.invoiceId ? String(body.invoiceId) : undefined,
      amountCents,
      currency: String(body.currency || 'MXN'),
      paymentMethod: String(body.paymentMethod || 'Efectivo'),
      reference: body.reference ? String(body.reference) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      entryDate: body.entryDate ? String(body.entryDate) : today(),
      createdAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('cash_register_entries').insert(this.cashToRow(entry));
      if (error) throw error;
    } else {
      collectionsMemory.cashEntries.unshift(entry);
    }
    return entry;
  }

  async getCashRegisterSummary(date?: string) {
    const entries = await this.listCashEntries({ date: date ?? today() });
    const totalCents = entries.reduce((s, e) => s + e.amountCents, 0);
    const byMethod = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.paymentMethod] = (acc[e.paymentMethod] ?? 0) + e.amountCents;
      return acc;
    }, {});
    return { date: date ?? today(), entryCount: entries.length, totalCents, byMethod, entries };
  }

  async getActivePromisesCount() {
    const list = await this.listPromises({ status: 'active' });
    return list.length;
  }

  private rowToPromise(row: Record<string, unknown>): PaymentPromise {
    return {
      id: String(row.id), clientId: String(row.client_id), promisedDate: String(row.promised_date),
      amountCents: Number(row.amount_cents), currency: String(row.currency),
      status: row.status as PaymentPromise['status'],
      blocksSuspension: Boolean(row.blocks_suspension),
      notes: row.notes ? String(row.notes) : undefined,
      createdBy: row.created_by ? String(row.created_by) : undefined,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private promiseToRow(p: PaymentPromise) {
    return {
      id: p.id, client_id: p.clientId, promised_date: p.promisedDate, amount_cents: p.amountCents,
      currency: p.currency, status: p.status, blocks_suspension: p.blocksSuspension,
      notes: p.notes ?? null, created_by: p.createdBy ?? null,
      created_at: p.createdAt, updated_at: p.updatedAt,
    };
  }

  private rowToCash(row: Record<string, unknown>): CashRegisterEntry {
    return {
      id: String(row.id),
      collectorId: row.collector_id ? String(row.collector_id) : undefined,
      collectorName: row.collector_name ? String(row.collector_name) : undefined,
      clientId: row.client_id ? String(row.client_id) : undefined,
      invoiceId: row.invoice_id ? String(row.invoice_id) : undefined,
      amountCents: Number(row.amount_cents), currency: String(row.currency),
      paymentMethod: String(row.payment_method),
      reference: row.reference ? String(row.reference) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      entryDate: String(row.entry_date), createdAt: String(row.created_at),
    };
  }

  private cashToRow(e: CashRegisterEntry) {
    return {
      id: e.id, collector_id: e.collectorId ?? null, collector_name: e.collectorName ?? null,
      client_id: e.clientId ?? null, invoice_id: e.invoiceId ?? null,
      amount_cents: e.amountCents, currency: e.currency, payment_method: e.paymentMethod,
      reference: e.reference ?? null, notes: e.notes ?? null,
      entry_date: e.entryDate, created_at: e.createdAt,
    };
  }
}

let cached: CollectionsService | null = null;
export const getCollectionsService = () => {
  if (!cached) cached = new CollectionsService();
  return cached;
};

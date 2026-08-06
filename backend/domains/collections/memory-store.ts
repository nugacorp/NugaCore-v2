import { randomBytes } from 'node:crypto';

export interface PaymentPromise {
  id: string;
  tenantId?: string;
  clientId: string;
  promisedDate: string;
  amountCents: number;
  currency: string;
  status: 'active' | 'fulfilled' | 'broken' | 'canceled';
  blocksSuspension: boolean;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CashRegisterEntry {
  id: string;
  tenantId?: string;
  collectorId?: string;
  collectorName?: string;
  clientId?: string;
  invoiceId?: string;
  amountCents: number;
  currency: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  entryDate: string;
  createdAt: string;
}

export const collectionsMemory = {
  promises: [] as PaymentPromise[],
  cashEntries: [] as CashRegisterEntry[],
};

/** Sufijo aleatorio: `Date.now()` solo colisiona al generar ids en ráfaga. */
export const uid = (p: string) => `${p}-${Date.now()}-${randomBytes(4).toString('hex')}`;
export const today = () => new Date().toISOString().substring(0, 10);
export const stamp = () => new Date().toISOString();

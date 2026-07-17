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

export const uid = (p: string) => `${p}-${Date.now()}`;
export const today = () => new Date().toISOString().substring(0, 10);
export const stamp = () => new Date().toISOString();

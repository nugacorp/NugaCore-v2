// ====================================================================
// SuspensionDataProvider (Fase 4.5.1).
//
// Abstracción de SOLO LECTURA sobre Customers/Billing para que el motor
// evalúe los datos REALES vivan donde vivan (store mock o Supabase DB).
//
// Causa raíz del FAIL 4.5: el motor leía store.CLIENTS/INVOICES directamente,
// así que con USE_DB_CUSTOMERS/USE_DB_BILLING=true los datos creados en DB
// nunca llegaban al motor. Aquí se delega a los services de cada dominio,
// que ya eligen store-o-DB según su propio flag → sin duplicar lógica.
// ====================================================================

import { Client, Invoice } from '../../../src/types';
import { store } from '../../state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { getCustomersService } from '../customers/service';
import { getBillingService } from '../billing/service';

export interface CustomerLite {
  id: string;
  name: string;
  status: string; // 'active' | 'suspended' | 'lead' | 'baja'
}

export interface SuspensionDataProvider {
  loadCustomers(): Promise<CustomerLite[]>;
  getCustomer(id: string): Promise<CustomerLite | null>;
  loadInvoices(): Promise<Invoice[]>;
}

const toLite = (c: Client): CustomerLite => ({ id: c.id, name: c.name, status: c.status });

// ── Mock directo: lee el store en memoria (rápido y determinista) ──────
export class StoreSuspensionDataProvider implements SuspensionDataProvider {
  async loadCustomers(): Promise<CustomerLite[]> {
    return store.CLIENTS.map(toLite);
  }
  async getCustomer(id: string): Promise<CustomerLite | null> {
    const c = store.CLIENTS.find((x) => x.id === id);
    return c ? toLite(c) : null;
  }
  async loadInvoices(): Promise<Invoice[]> {
    return store.INVOICES;
  }
}

// ── Vía services: correcto en CUALQUIER combinación de flags ───────────
//    (los services de Customers/Billing ya devuelven DB o store según su flag)
export class ServiceSuspensionDataProvider implements SuspensionDataProvider {
  async loadCustomers(): Promise<CustomerLite[]> {
    const clients = await getCustomersService().list({});
    return clients.map(toLite);
  }
  async getCustomer(id: string): Promise<CustomerLite | null> {
    const c = await getCustomersService().getById(id);
    return c ? toLite(c) : null;
  }
  async loadInvoices(): Promise<Invoice[]> {
    // EnrichedInvoice extiende Invoice (incluye paidAmount/pendingAmount).
    return getBillingService().listInvoices();
  }
}

/**
 * Selección del provider:
 *   - Si Customers o Billing están en DB → ServiceSuspensionDataProvider
 *     (lee los datos reales a través de sus services).
 *   - Si ambos son mock → StoreSuspensionDataProvider (camino directo).
 */
export const buildSuspensionDataProvider = (): SuspensionDataProvider => {
  if (isDomainOnDb('customers') || isDomainOnDb('billing')) {
    return new ServiceSuspensionDataProvider();
  }
  return new StoreSuspensionDataProvider();
};

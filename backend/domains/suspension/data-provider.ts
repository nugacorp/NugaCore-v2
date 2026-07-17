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
  loadCustomers(tenantId?: string): Promise<CustomerLite[]>;
  getCustomer(id: string, tenantId?: string): Promise<CustomerLite | null>;
  loadInvoices(tenantId?: string): Promise<Invoice[]>;
}

const toLite = (c: Client): CustomerLite => ({ id: c.id, name: c.name, status: c.status });

const matchesTenant = (recordTenantId: string | undefined, tenantId: string): boolean =>
  (recordTenantId || 'tenant-default') === tenantId;

// ── Mock directo: lee el store en memoria (rápido y determinista) ──────
export class StoreSuspensionDataProvider implements SuspensionDataProvider {
  async loadCustomers(tenantId?: string): Promise<CustomerLite[]> {
    const rows = tenantId
      ? store.CLIENTS.filter((c) => matchesTenant(c.tenantId, tenantId))
      : store.CLIENTS;
    return rows.map(toLite);
  }
  async getCustomer(id: string, tenantId?: string): Promise<CustomerLite | null> {
    const c = store.CLIENTS.find((x) => {
      if (x.id !== id) return false;
      if (!tenantId) return true;
      return matchesTenant(x.tenantId, tenantId);
    });
    return c ? toLite(c) : null;
  }
  async loadInvoices(tenantId?: string): Promise<Invoice[]> {
    if (!tenantId) return store.INVOICES;
    return store.INVOICES.filter((inv) => matchesTenant(inv.tenantId, tenantId));
  }
}

// ── Vía services: correcto en CUALQUIER combinación de flags ───────────
//    (los services de Customers/Billing ya devuelven DB o store según su flag)
export class ServiceSuspensionDataProvider implements SuspensionDataProvider {
  async loadCustomers(tenantId?: string): Promise<CustomerLite[]> {
    const clients = await getCustomersService().list(tenantId ? { tenantId } : {});
    return clients.map(toLite);
  }
  async getCustomer(id: string, tenantId?: string): Promise<CustomerLite | null> {
    const c = await getCustomersService().getById(id, tenantId);
    return c ? toLite(c) : null;
  }
  async loadInvoices(tenantId?: string): Promise<Invoice[]> {
    // EnrichedInvoice extiende Invoice (incluye paidAmount/pendingAmount).
    return getBillingService().listInvoices(tenantId);
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

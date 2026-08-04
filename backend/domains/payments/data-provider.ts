// ====================================================================
// PaymentDataProvider (Fase 4.8 HOTFIX — Blocker 2).
//
// Abstracción que permite al Payment Engine leer y actualizar clientes
// independientemente de si el dominio customers vive en store o en DB.
//
// Causa raíz del Blocker 2 en staging: reactivateCustomerService leía
// store.CLIENTS directamente → invisible con USE_DB_CUSTOMERS=true.
// Solución: mismo patrón que SuspensionDataProvider (Fase 4.5.1).
// ====================================================================

import { Client } from '../../../src/types';
import { store } from '../../state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { getCustomersService } from '../customers/service';

export interface CustomerLite {
  id: string;
  name: string;
  status: string;
  routerId?: string;
  pppoeUser?: string;
}

export interface PaymentDataProvider {
  getCustomer(id: string, tenantId?: string): Promise<CustomerLite | null>;
  reactivateCustomer(id: string, tenantId?: string): Promise<void>;
}

const toLite = (c: Client): CustomerLite => ({
  id: c.id,
  name: c.name,
  status: c.status,
  routerId: c.routerId,
  pppoeUser: c.pppoeUser,
});

const matchesTenant = (recordTenantId: string | undefined, tenantId: string): boolean =>
  (recordTenantId || 'tenant-default') === tenantId;

// ── Store directo: rápido y determinista (USE_DB_CUSTOMERS=false) ──────
export class StorePaymentDataProvider implements PaymentDataProvider {
  async getCustomer(id: string, tenantId?: string): Promise<CustomerLite | null> {
    const c = store.CLIENTS.find((x) => {
      if (x.id !== id) return false;
      if (tenantId && !matchesTenant(x.tenantId, tenantId)) return false;
      return true;
    });
    return c ? toLite(c) : null;
  }
  async reactivateCustomer(id: string, tenantId?: string): Promise<void> {
    const c = store.CLIENTS.find((x) => {
      if (x.id !== id) return false;
      if (tenantId && !matchesTenant(x.tenantId, tenantId)) return false;
      return true;
    });
    if (c) c.status = 'active';
  }
}

// ── Vía CustomersService: correcto con USE_DB_CUSTOMERS=true ──────────
export class ServicePaymentDataProvider implements PaymentDataProvider {
  async getCustomer(id: string, tenantId?: string): Promise<CustomerLite | null> {
    const c = await getCustomersService().getById(id, tenantId);
    return c ? toLite(c) : null;
  }
  async reactivateCustomer(id: string, tenantId?: string): Promise<void> {
    await getCustomersService().update(id, { status: 'active' }, tenantId);
  }
}

/**
 * Si customers está en DB → ServicePaymentDataProvider (lee datos reales).
 * Si ambos son mock → StorePaymentDataProvider (camino directo al store).
 */
export const buildPaymentDataProvider = (): PaymentDataProvider => {
  if (isDomainOnDb('customers')) return new ServicePaymentDataProvider();
  return new StorePaymentDataProvider();
};

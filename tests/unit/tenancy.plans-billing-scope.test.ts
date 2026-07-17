import { describe, expect, it } from 'vitest';
import { StorePlansRepository } from '../../backend/domains/plans/repository';
import { StoreBillingRepository } from '../../backend/domains/billing/repository';
import type { PlanRecord } from '../../backend/domains/plans/mappers';

const basePlan = (overrides: Partial<PlanRecord>): PlanRecord => ({
  id: overrides.id || 'plan-test',
  name: overrides.name || 'Plan Test',
  downloadSpeed: 50,
  uploadSpeed: 20,
  price: 399,
  businessType: 'residential',
  isActive: true,
  ...overrides,
});

describe('Plans tenant scope (store)', () => {
  it('lista y obtiene solo planes del tenant solicitado', async () => {
    const repo = new StorePlansRepository();
    const stamp = Date.now();
    const a = basePlan({ id: `plan-mt-a-${stamp}`, name: `Plan A ${stamp}`, tenantId: 'tenant-a' });
    const b = basePlan({ id: `plan-mt-b-${stamp}`, name: `Plan B ${stamp}`, tenantId: 'tenant-b' });
    await repo.create(a);
    await repo.create(b);

    const onlyA = await repo.list({ tenantId: 'tenant-a' });
    expect(onlyA.some((p) => p.id === a.id)).toBe(true);
    expect(onlyA.some((p) => p.id === b.id)).toBe(false);

    expect(await repo.findById(b.id, 'tenant-a')).toBeNull();
    expect(await repo.findById(b.id, 'tenant-b')).not.toBeNull();

    await repo.remove(a.id, 'tenant-a');
    await repo.remove(b.id, 'tenant-b');
  });
});

describe('Billing invoices tenant scope (store)', () => {
  it('lista y obtiene solo facturas del tenant solicitado', async () => {
    const repo = new StoreBillingRepository();
    const stamp = Date.now();
    const invA = await repo.createInvoice({
      clientId: `c-mt-a-${stamp}`,
      clientName: 'Cliente A',
      amount: 100,
      dueDateStr: '2099-01-15',
      items: [{ description: 'Servicio', price: 100, qty: 1 }],
      tenantId: 'tenant-a',
    });
    const invB = await repo.createInvoice({
      clientId: `c-mt-b-${stamp}`,
      clientName: 'Cliente B',
      amount: 200,
      dueDateStr: '2099-01-15',
      items: [{ description: 'Servicio', price: 200, qty: 1 }],
      tenantId: 'tenant-b',
    });

    const onlyA = await repo.listInvoices('tenant-a');
    expect(onlyA.some((i) => i.id === invA.id)).toBe(true);
    expect(onlyA.some((i) => i.id === invB.id)).toBe(false);

    expect(await repo.findInvoiceById(invB.id, 'tenant-a')).toBeNull();
    expect(await repo.findInvoiceById(invB.id, 'tenant-b')).not.toBeNull();

    await repo.cancelInvoice(invA.id, 'cleanup', 'tenant-a');
    await repo.cancelInvoice(invB.id, 'cleanup', 'tenant-b');
  });

  it('no permite pagar factura de otro tenant', async () => {
    const repo = new StoreBillingRepository();
    const stamp = Date.now();
    const inv = await repo.createInvoice({
      clientId: `c-pay-${stamp}`,
      clientName: 'Pay Client',
      amount: 150,
      dueDateStr: '2099-02-01',
      items: [{ description: 'Servicio', price: 150, qty: 1 }],
      tenantId: 'tenant-a',
    });

    await expect(
      repo.recordPayment(
        inv.id,
        { amount: 150, method: 'Efectivo', transactionId: 'TXN_X' },
        'tenant-b',
      ),
    ).rejects.toThrow();

    const stillUnpaid = await repo.findInvoiceById(inv.id, 'tenant-a');
    expect(stillUnpaid?.status).not.toBe('paid');
    await repo.cancelInvoice(inv.id, 'cleanup', 'tenant-a');
  });
});

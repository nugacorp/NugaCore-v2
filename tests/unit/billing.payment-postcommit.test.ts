import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestError, errorHandler } from '../../backend/common/errors';

const mocks = vi.hoisted(() => ({
  findInvoiceById: vi.fn(),
  validatePayment: vi.fn(),
  recordPayment: vi.fn(),
  getPolicy: vi.fn(),
  getCustomer: vi.fn(),
  loadInvoices: vi.fn(),
  listSuspensionBlocks: vi.fn(),
  recordEvent: vi.fn(),
  reactivate: vi.fn(),
}));

vi.mock('../../backend/config/feature-flags', () => ({
  isDomainOnDb: (domain: string) => domain === 'billing',
}));
vi.mock('../../backend/domains/billing/service', () => ({
  getBillingService: () => ({
    findInvoiceById: mocks.findInvoiceById,
    validatePayment: mocks.validatePayment,
    recordPayment: mocks.recordPayment,
  }),
}));
vi.mock('../../backend/domains/billing/cycle', () => ({
  getBillingCycleService: () => ({}),
}));
vi.mock('../../backend/domains/suspension/service', () => ({
  getSuspensionService: () => ({
    repo: {
      getPolicy: mocks.getPolicy,
      listSuspensionBlocks: mocks.listSuspensionBlocks,
      recordEvent: mocks.recordEvent,
    },
    data: {
      getCustomer: mocks.getCustomer,
      loadInvoices: mocks.loadInvoices,
    },
  }),
}));
vi.mock('../../backend/domains/payments/service', () => ({
  getPaymentService: () => ({ reactivateCustomerService: mocks.reactivate }),
}));

import billingRoutes from '../../backend/domains/billing/routes';

const invoice = {
  id: 'invoice-postcommit', tenantId: 'tenant-postcommit', clientId: 'client-postcommit',
  clientName: 'Cliente postcommit', amount: 100, paidAmount: 0, pendingAmount: 100,
  status: 'unpaid', cfdiStatus: 'pending', dateStr: '2026-08-01', dueDateStr: '2099-12-31',
  items: [], payments: [],
};
const paid = {
  ...invoice, paidAmount: 100, pendingAmount: 0, status: 'paid',
  payments: [{ date: '2026-08-01', amount: 100, method: 'SPEI', transactionId: 'manual-stable' }],
};

describe('Billing: frontera post-commit de reactivación', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.authContext = {
        userId: 'operator-postcommit',
        role: 'cobranza',
        tenantId: 'tenant-postcommit',
        source: 'trusted-headers',
      };
      next();
    });
    app.use(billingRoutes);
    app.use(errorHandler);

    mocks.findInvoiceById.mockResolvedValueOnce(invoice).mockResolvedValue(paid);
    mocks.validatePayment.mockImplementation((current) => {
      if (current.pendingAmount <= 0) throw new BadRequestError('Invoice is already fully paid', 'ALREADY_PAID');
      return { amount: 100, method: 'SPEI', transactionId: 'manual-stable' };
    });
    mocks.recordPayment.mockResolvedValue(paid);
    mocks.getPolicy.mockResolvedValue({
      id: 'default',
      name: 'default',
      enabled: true,
      graceDays: 3,
      suspendAfterDue: true,
      reactivateOnPayment: true,
      reactivateOnPartialPayment: false,
      autoReactivate: true,
      dueSoonDays: 3,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    mocks.getCustomer.mockResolvedValue({ id: invoice.clientId, status: 'suspended' });
    mocks.loadInvoices.mockResolvedValue([paid]);
    mocks.listSuspensionBlocks.mockResolvedValue([]);
    mocks.recordEvent.mockResolvedValue({ id: 'sev-postcommit' });
    mocks.reactivate.mockRejectedValue(new Error('router unavailable after payment commit'));
  });

  it('responde el pago confirmado y un retry no vuelve a persistirlo', async () => {
    const first = await request(app)
      .post(`/api/billing/invoices/${invoice.id}/pay`)
      .set({ 'x-user-role': 'cobranza', 'x-user-id': 'operator-postcommit' })
      .send({ amount: 100, method: 'SPEI', transactionId: 'manual-stable' });
    const retry = await request(app)
      .post(`/api/billing/invoices/${invoice.id}/pay`)
      .set({ 'x-user-role': 'cobranza', 'x-user-id': 'operator-postcommit' })
      .send({ amount: 100, method: 'SPEI', transactionId: 'manual-stable' });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'paid', payments: [{ transactionId: 'manual-stable' }] });
    expect(retry.status).toBe(400);
    expect(mocks.recordPayment).toHaveBeenCalledTimes(1);
    expect(mocks.reactivate).toHaveBeenCalledTimes(1);
  });
});

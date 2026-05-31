import { Router } from 'express';
import { Invoice } from '../../../src/types';
import { store } from '../../../backend/state/store';
import { requireRoles } from '../../common/rbac';

const router = Router();

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const invoicePaidAmount = (invoice: Invoice): number => {
  return roundMoney(invoice.payments.reduce((acc, payment) => acc + Number(payment.amount || 0), 0));
};

const invoicePendingAmount = (invoice: Invoice): number => {
  return roundMoney(Math.max(invoice.amount - invoicePaidAmount(invoice), 0));
};

const syncInvoiceStatus = (invoice: Invoice): void => {
  const pending = invoicePendingAmount(invoice);
  const isPastDue = new Date(invoice.dueDateStr).getTime() < Date.now();
  if (pending <= 0) {
    invoice.status = 'paid';
    invoice.cfdiStatus = 'generated';
    if (!invoice.cfdiUuid) {
      invoice.cfdiUuid =
        '4F17A9B9-' +
        Math.floor(Math.random() * 9000 + 1000) +
        '-4EF2-BD44-FFBBAA123' +
        Math.floor(Math.random() * 90 + 10);
    }
    return;
  }

  invoice.status = isPastDue ? 'overdue' : 'unpaid';
  if (invoice.cfdiStatus === 'generated' && pending > 0) {
    invoice.cfdiStatus = 'pending';
  }
};

const withAccountState = (invoice: Invoice) => ({
  ...invoice,
  paidAmount: invoicePaidAmount(invoice),
  pendingAmount: invoicePendingAmount(invoice),
});

const refreshAllInvoiceStatuses = () => {
  store.INVOICES.forEach(syncInvoiceStatus);
};

router.get('/api/billing/invoices', (_req, res) => {
  refreshAllInvoiceStatuses();
  res.json(store.INVOICES.map(withAccountState));
});

router.get('/api/billing/invoices/:id/account-state', (req, res) => {
  const invoice = store.INVOICES.find((row) => row.id === req.params.id);
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice ledger not found' });
  }

  syncInvoiceStatus(invoice);
  res.json({
    invoice: withAccountState(invoice),
    allocations: store.PAYMENT_ALLOCATIONS.filter((allocation) => allocation.invoiceId === invoice.id),
  });
});

router.get('/api/billing/account-summary', (_req, res) => {
  refreshAllInvoiceStatuses();

  const totals = store.INVOICES.reduce(
    (acc, invoice) => {
      const paidAmount = invoicePaidAmount(invoice);
      const pendingAmount = invoicePendingAmount(invoice);
      acc.totalInvoiced += invoice.amount;
      acc.totalCollected += paidAmount;
      acc.totalPending += pendingAmount;
      if (invoice.status === 'overdue') acc.overdueCount += 1;
      if (invoice.status === 'paid') acc.paidCount += 1;
      return acc;
    },
    {
      totalInvoiced: 0,
      totalCollected: 0,
      totalPending: 0,
      overdueCount: 0,
      paidCount: 0,
    },
  );

  res.json({
    ...totals,
    invoicesCount: store.INVOICES.length,
    unpaidCount: store.INVOICES.filter((invoice) => invoice.status === 'unpaid').length,
  });
});

router.get('/api/billing/revenue-report', (_req, res) => {
  refreshAllInvoiceStatuses();

  const byMethod = new Map<string, number>();
  for (const invoice of store.INVOICES) {
    for (const payment of invoice.payments) {
      const method = payment.method || 'Otro';
      byMethod.set(method, roundMoney((byMethod.get(method) || 0) + Number(payment.amount || 0)));
    }
  }

  res.json({
    generatedAt: new Date().toISOString(),
    byMethod: Array.from(byMethod.entries()).map(([method, amount]) => ({ method, amount })),
    topPendingInvoices: store.INVOICES
      .map(withAccountState)
      .filter((invoice) => invoice.pendingAmount > 0)
      .sort((a, b) => b.pendingAmount - a.pendingAmount)
      .slice(0, 10),
  });
});

router.post('/api/billing/invoices/:id/pay', requireRoles(['super admin', 'administrador', 'cobranza']), (req, res) => {
  const { id } = req.params;
  const { method, amount, transactionId } = req.body;
  const invoice = store.INVOICES.find((f) => f.id === id);
  if (invoice) {
    syncInvoiceStatus(invoice);
    const currentPending = invoicePendingAmount(invoice);
    if (currentPending <= 0) {
      return res.status(400).json({ error: 'Invoice is already fully paid' });
    }

    const parsedAmount = Number(amount);
    const paymentAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? roundMoney(parsedAmount) : currentPending;

    if (paymentAmount > currentPending) {
      return res.status(400).json({ error: 'Payment amount exceeds invoice pending balance' });
    }

    const resolvedMethod = method || 'Transferencia';
    const resolvedTransactionId =
      transactionId || 'TXN_' + Math.random().toString(36).substring(3, 11).toUpperCase();

    invoice.payments.push({
      date: new Date().toISOString().replace('T', ' ').substring(0, 16),
      amount: paymentAmount,
      method: resolvedMethod,
      transactionId: resolvedTransactionId,
    });

    syncInvoiceStatus(invoice);
    const pendingAfterPayment = invoicePendingAmount(invoice);

    store.PAYMENT_ALLOCATIONS.unshift({
      id: store.getUniquePaymentAllocationId(),
      invoiceId: invoice.id,
      amount: paymentAmount,
      method: resolvedMethod,
      paymentDate: new Date().toISOString(),
      transactionId: resolvedTransactionId,
      remainingAfterPayment: pendingAfterPayment,
    });

    const client = store.CLIENTS.find((c) => c.id === invoice.clientId);
    if (client && client.status === 'suspended' && store.SUSPENSION_POLICY.allowAutoReactivateOnPayment) {
      client.status = 'active';
      store.MIKROTIK_LOGS.push({
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `script,info Automations Flow: billing payment success of ${invoice.id} triggers reactivate customer state for ${client.pppoeUser}`,
      });
      store.createAlert('client', 'info', client.name, `Pago recibido via ${method}. Cuenta reactivada automaticamente a velocidad completa.`);
      store.logSuspensionAction({
        clientId: client.id,
        clientName: client.name,
        action: 'reactivate',
        reason: `Pago conciliado en factura ${invoice.id}.`,
        source: 'automation',
        actorId: req.authContext?.userId,
      });
      store.addClientTimelineEvent({
        clientId: client.id,
        eventType: 'status_change',
        summary: 'Cambio de estatus suspended -> active',
        details: `Reactivacion automatica posterior al pago de factura ${invoice.id}.`,
        createdBy: req.authContext?.userId,
      });
    }

    res.json(withAccountState(invoice));
  } else {
    res.status(404).json({ error: 'Invoice ledger not found' });
  }
});

router.post('/api/billing/invoices', requireRoles(['super admin', 'administrador', 'cobranza']), (req, res) => {
  const { clientId, amount, dueDateStr, items } = req.body;
  const client = store.CLIENTS.find((c) => c.id === clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const resolvedAmount = Number(amount) || 0;
  const newInvoice: Invoice = {
    id: 'fac-' + (store.INVOICES.length + 101) + '-' + Math.floor(Math.random() * 900 + 100),
    clientId,
    clientName: client.name,
    amount: resolvedAmount,
    dateStr: new Date().toISOString().substring(0, 10),
    dueDateStr: dueDateStr || new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
    status: 'unpaid',
    cfdiStatus: 'pending',
    items: items && items.length > 0 ? items : [{ description: 'Servicio de Internet banda ancha para Suscriptor', price: resolvedAmount, qty: 1 }],
    payments: [],
  };
  store.INVOICES.unshift(newInvoice);
  res.status(201).json(withAccountState(newInvoice));
});

router.put('/api/billing/invoices/:id', requireRoles(['super admin', 'administrador', 'cobranza']), (req, res) => {
  const { id } = req.params;
  const { amount, dueDateStr, items, status } = req.body;
  const invoice = store.INVOICES.find((inv) => inv.id === id);
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  if (amount !== undefined) invoice.amount = Number(amount);
  if (dueDateStr !== undefined) invoice.dueDateStr = dueDateStr;
  if (items !== undefined) invoice.items = items;
  if (status !== undefined) invoice.status = status;
  syncInvoiceStatus(invoice);
  res.json(withAccountState(invoice));
});

export default router;

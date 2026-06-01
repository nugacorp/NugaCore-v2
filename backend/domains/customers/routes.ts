import { Router } from 'express';
import { Client, Invoice, OnuFTTH } from '../../../src/types';
import { store } from '../../../backend/state/store';
import { requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { getCustomersService, parseClientStatus, parseClientType } from './service';

const router = Router();

// Persistencia detrás de feature flag USE_DB_CUSTOMERS (store mock | Supabase).
// El contrato de API v1 (rutas, payloads, formas de respuesta) NO cambia.
// Los efectos cruzados con otros dominios (facturas, ONUs, logs MikroTik,
// alertas) NO están migrados y siguen operando contra el store en ambos modos.

router.get('/api/clients', asyncHandler(async (req, res) => {
  const status = parseClientStatus(req.query.status);
  const type = parseClientType(req.query.type);
  const city = String(req.query.city || '').trim().toLowerCase();
  const planId = String(req.query.planId || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();

  const rows = await getCustomersService().list({ status, type, city, planId, q });
  res.json(rows);
}));

router.get('/api/clients/:id/history', asyncHandler(async (req, res) => {
  const events = await getCustomersService().getHistory(req.params.id);
  res.json(events);
}));

router.get('/api/clients/:id', asyncHandler(async (req, res) => {
  const client = await getCustomersService().getById(req.params.id);
  if (!client) {
    return res.status(404).json({ error: 'Customer not found' });
  }
  res.json(client);
}));

router.post('/api/clients', requireRoles(['super admin', 'administrador', 'soporte']), asyncHandler(async (req, res) => {
  const service = getCustomersService();
  const { name, type, email, phone, address, city, planId, lat, lng, isConvertLead, leadId, notes, connectionType } = req.body;

  // Validación de entrada (lanza 400 si es inválida).
  const { type: clientType } = service.validateCreate({ name, type, address, city, email });

  const planExists = store.PLANS.some((p) => p.id === (planId || 'plan-basic'));
  if (!planExists) {
    return res.status(400).json({ error: 'Plan not found' });
  }

  const requestedStatus = parseClientStatus(req.body.status);
  const randomSub = Math.floor(Math.random() * 253) + 2;

  const newClient: Client = {
    id: await service.generateClientId(),
    name,
    type: clientType,
    status: isConvertLead ? 'active' : requestedStatus || 'active',
    email: email || 'sin-correo@nuga.core',
    phone: phone || '',
    address: address || '',
    city: city || 'CDMX',
    lat: Number(lat) || 19.4125,
    lng: Number(lng) || -99.1555,
    planId: planId || 'plan-basic',
    connectionType: connectionType || (clientType === 'corporate' || clientType === 'hotel' ? 'FTTH' : 'WISP'),
    ip: isConvertLead ? `10.100.10.${randomSub}` : '0.0.0.0',
    mac: isConvertLead ? `00:1A:79:A1:BA:${randomSub.toString(16).toUpperCase().padStart(2, '0')}` : undefined,
    pppoeUser: isConvertLead ? `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_nuga` : undefined,
    pppoePassword: isConvertLead ? 'NugaSecretPass' : undefined,
    contractId: isConvertLead ? `CONT-2026-${120 + store.CLIENTS.length}` : undefined,
    installationDate: isConvertLead ? new Date().toISOString().substring(0, 10) : undefined,
    notes: notes || '',
  };

  await service.create(newClient);
  await service.addTimelineEvent({
    clientId: newClient.id,
    eventType: 'created',
    summary: 'Cliente registrado en CRM',
    details: `Alta de cliente con estatus ${newClient.status} y plan ${newClient.planId}.`,
    createdBy: req.authContext?.userId,
  });

  if (isConvertLead && leadId) {
    // El lead original (cliente) se elimina vía service (DB cascada el timeline).
    await service.remove(leadId);
    store.createAlert('client', 'info', name, 'Lead convertido exitosamente a Cliente.');
    await service.addTimelineEvent({
      clientId: newClient.id,
      eventType: 'lead_conversion',
      summary: 'Lead convertido a cliente activo',
      details: `${name} fue convertido a cliente con contrato inicial.`,
      createdBy: req.authContext?.userId,
    });
  }

  if (isConvertLead) {
    // Efectos cruzados (otros dominios, aún en store mock).
    const plan = store.PLANS.find((p) => p.id === newClient.planId);
    const cost = plan ? plan.price : 449;
    const newInvoice: Invoice = {
      id: store.getUniqueInvoiceId(),
      clientId: newClient.id,
      clientName: newClient.name,
      amount: cost,
      dateStr: new Date().toISOString().substring(0, 10),
      dueDateStr: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
      status: 'unpaid',
      cfdiStatus: 'pending',
      items: [{ description: `Cargo de instalacion y mensualidad anticipada - Plan ${plan?.name || 'Contrato'}`, price: cost, qty: 1 }],
      payments: [],
    };
    store.INVOICES.push(newInvoice);

    if (newClient.type === 'residential' || newClient.type === 'school') {
      const newOnu: OnuFTTH = {
        id: store.getUniqueOnuId(),
        clientId: newClient.id,
        clientName: newClient.name,
        oltId: 'olt-1',
        port: 1,
        mac: `HWTCA${randomSub}BBCC`,
        signalDb: -20.5,
        status: 'online',
        brand: 'Huawei',
        model: 'EG8145V5',
      };
      store.ONUS.push(newOnu);
    }

    store.MIKROTIK_LOGS.push({
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      message: `pppoe,info AutoProvisioning done for PPP clientSecret ${newClient.pppoeUser}`,
    });
  }

  res.status(201).json(newClient);
}));

router.put('/api/clients/:id', requireRoles(['super admin', 'administrador', 'cobranza']), asyncHandler(async (req, res) => {
  const service = getCustomersService();
  const { id } = req.params;

  const existing = await service.getById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  service.validateUpdate(req.body);

  const beforeStatus = existing.status;
  const requestedStatus = req.body.status ? parseClientStatus(req.body.status) : null;
  const nextStatus = requestedStatus || beforeStatus;

  if (req.body.planId) {
    const planExists = store.PLANS.some((p) => p.id === req.body.planId);
    if (!planExists) {
      return res.status(400).json({ error: 'Plan not found' });
    }
  }

  const updated = await service.update(id, { ...req.body, status: nextStatus });
  if (!updated) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (nextStatus === 'suspended' && beforeStatus !== 'suspended') {
    store.MIKROTIK_LOGS.push({
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      message: `script,info Core Router Suspended PPPoE: ${updated.pppoeUser || id} block address list active`,
    });
    store.createAlert('client', 'warning', updated.name, 'Linea de cliente automaticamente SUSPENDIDA en el Router Core por falta de pago.');
  } else if (nextStatus === 'active' && beforeStatus !== 'active') {
    store.MIKROTIK_LOGS.push({
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      message: `script,info Core Router Reactivated PPPoE: ${updated.pppoeUser || id} unblocked address list`,
    });
    store.createAlert('client', 'info', updated.name, 'Linea de cliente REACTIVADA con exito en MikroTik con velocidad completa.');
  }

  await service.addTimelineEvent({
    clientId: updated.id,
    eventType: beforeStatus !== nextStatus ? 'status_change' : 'updated',
    summary: beforeStatus !== nextStatus ? `Cambio de estatus ${beforeStatus} -> ${nextStatus}` : 'Datos de cliente actualizados',
    details: `Actualizacion aplicada sobre ${updated.name}.`,
    createdBy: req.authContext?.userId,
  });

  res.json(updated);
}));

router.delete('/api/clients/:id', requireRoles(['super admin', 'administrador']), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const removed = await getCustomersService().remove(id);
  if (!removed) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  // Limpieza de dominios aún no migrados (store mock).
  store.INVOICES = store.INVOICES.filter((i) => i.clientId !== id);
  store.ONUS = store.ONUS.filter((o) => o.clientId !== id);

  res.status(204).send();
}));

export default router;

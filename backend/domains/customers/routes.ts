import { Router } from 'express';
import { Client, Invoice, OnuFTTH } from '../../../src/types';
import { store } from '../../../backend/state/store';
import { requireRoles } from '../../common/rbac';

const router = Router();

const parseClientStatus = (value: unknown): Client['status'] | null => {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'suspended') return 'suspended';
  if (status === 'lead') return 'lead';
  if (status === 'baja') return 'baja';
  return null;
};

const parseClientType = (value: unknown): Client['type'] | null => {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'residential') return 'residential';
  if (type === 'corporate') return 'corporate';
  if (type === 'government') return 'government';
  if (type === 'hotel') return 'hotel';
  if (type === 'school') return 'school';
  return null;
};

router.get('/api/clients', (req, res) => {
  const status = parseClientStatus(req.query.status);
  const type = parseClientType(req.query.type);
  const city = String(req.query.city || '').trim().toLowerCase();
  const planId = String(req.query.planId || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();

  const filtered = store.CLIENTS.filter((client) => {
    const matchesStatus = !status || client.status === status;
    const matchesType = !type || client.type === type;
    const matchesCity = !city || client.city.toLowerCase().includes(city);
    const matchesPlan = !planId || client.planId === planId;
    const matchesQuery =
      !q ||
      client.name.toLowerCase().includes(q) ||
      client.email.toLowerCase().includes(q) ||
      client.phone.includes(q);

    return matchesStatus && matchesType && matchesCity && matchesPlan && matchesQuery;
  });

  res.json(filtered);
});

router.get('/api/clients/:id/history', (req, res) => {
  const events = store.CLIENT_TIMELINE.filter((e) => e.clientId === req.params.id);
  res.json(events);
});

router.get('/api/clients/:id', (req, res) => {
  const client = store.CLIENTS.find((c) => c.id === req.params.id);
  if (!client) {
    return res.status(404).json({ error: 'Customer not found' });
  }
  res.json(client);
});

router.post('/api/clients', requireRoles(['super admin', 'administrador', 'soporte']), (req, res) => {
  const { name, type, email, phone, address, city, planId, lat, lng, isConvertLead, leadId, notes, connectionType } = req.body;

  if (!name || !type || !address || !city) {
    return res.status(400).json({ error: 'Missing required fields: name, type, address, city' });
  }

  const clientType = parseClientType(type);
  if (!clientType) {
    return res.status(400).json({ error: 'Invalid client type' });
  }

  const planExists = store.PLANS.some((p) => p.id === (planId || 'plan-basic'));
  if (!planExists) {
    return res.status(400).json({ error: 'Plan not found' });
  }

  const requestedStatus = parseClientStatus(req.body.status);

  if (isConvertLead && leadId) {
    store.CLIENTS = store.CLIENTS.filter((c) => c.id !== leadId);
    store.createAlert('client', 'info', name, 'Lead convertido exitosamente a Cliente.');
    store.addClientTimelineEvent({
      clientId: leadId,
      eventType: 'lead_conversion',
      summary: 'Lead convertido a cliente activo',
      details: `${name} fue convertido a cliente con contrato inicial.`,
      createdBy: req.authContext?.userId,
    });
  }

  const randomSub = Math.floor(Math.random() * 253) + 2;
  const newClient: Client = {
    id: store.getUniqueClientId(),
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

  store.CLIENTS.push(newClient);
  store.addClientTimelineEvent({
    clientId: newClient.id,
    eventType: 'created',
    summary: 'Cliente registrado en CRM',
    details: `Alta de cliente con estatus ${newClient.status} y plan ${newClient.planId}.`,
    createdBy: req.authContext?.userId,
  });

  if (isConvertLead) {
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
});

router.put('/api/clients/:id', requireRoles(['super admin', 'administrador', 'cobranza']), (req, res) => {
  const { id } = req.params;
  const index = store.CLIENTS.findIndex((c) => c.id === id);
  if (index !== -1) {
    const beforeStatus = store.CLIENTS[index].status;
    const requestedStatus = req.body.status ? parseClientStatus(req.body.status) : null;
    const nextStatus = requestedStatus || beforeStatus;

    if (req.body.planId) {
      const planExists = store.PLANS.some((p) => p.id === req.body.planId);
      if (!planExists) {
        return res.status(400).json({ error: 'Plan not found' });
      }
    }

    store.CLIENTS[index] = { ...store.CLIENTS[index], ...req.body, status: nextStatus };

    if (nextStatus === 'suspended' && beforeStatus !== 'suspended') {
      store.MIKROTIK_LOGS.push({
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `script,info Core Router Suspended PPPoE: ${store.CLIENTS[index].pppoeUser || id} block address list active`,
      });
      store.createAlert('client', 'warning', store.CLIENTS[index].name, 'Linea de cliente automaticamente SUSPENDIDA en el Router Core por falta de pago.');
    } else if (nextStatus === 'active' && beforeStatus !== 'active') {
      store.MIKROTIK_LOGS.push({
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `script,info Core Router Reactivated PPPoE: ${store.CLIENTS[index].pppoeUser || id} unblocked address list`,
      });
      store.createAlert('client', 'info', store.CLIENTS[index].name, 'Linea de cliente REACTIVADA con exito en MikroTik con velocidad completa.');
    }

    store.addClientTimelineEvent({
      clientId: store.CLIENTS[index].id,
      eventType: beforeStatus !== nextStatus ? 'status_change' : 'updated',
      summary: beforeStatus !== nextStatus ? `Cambio de estatus ${beforeStatus} -> ${nextStatus}` : 'Datos de cliente actualizados',
      details: `Actualizacion aplicada sobre ${store.CLIENTS[index].name}.`,
      createdBy: req.authContext?.userId,
    });

    res.json(store.CLIENTS[index]);
  } else {
    res.status(404).json({ error: 'Customer not found' });
  }
});

router.delete('/api/clients/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const { id } = req.params;
  const target = store.CLIENTS.find((c) => c.id === id);
  if (!target) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  store.CLIENTS = store.CLIENTS.filter((c) => c.id !== id);
  store.INVOICES = store.INVOICES.filter((i) => i.clientId !== id);
  store.ONUS = store.ONUS.filter((o) => o.clientId !== id);
  store.CLIENT_TIMELINE = store.CLIENT_TIMELINE.filter((e) => e.clientId !== id);

  res.status(204).send();
});

export default router;

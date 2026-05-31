import { Router } from 'express';
import { TaskOrder, Ticket } from '../../../src/types';
import { store } from '../../../backend/state/store';
import { requireRoles } from '../../common/rbac';

const router = Router();

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

const parseTicketStatus = (value: unknown): Ticket['status'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'open') return 'open';
  if (normalized === 'assigned') return 'assigned';
  if (normalized === 'resolved') return 'resolved';
  if (normalized === 'closed') return 'closed';
  return null;
};

const parseTicketSeverity = (value: unknown): Ticket['severity'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low') return 'low';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'high') return 'high';
  if (normalized === 'critical') return 'critical';
  return null;
};

const parseTicketCategory = (value: unknown): Ticket['category'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'internet') return 'Internet';
  if (normalized === 'facturacion') return 'Facturacion';
  if (normalized === 'instalacion') return 'Instalacion';
  if (normalized === 'falla red') return 'Falla Red';
  if (normalized === 'otro') return 'Otro';
  return null;
};

const parseTicketPriority = (value: unknown): NonNullable<Ticket['priority']> | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'P1') return 'P1';
  if (normalized === 'P2') return 'P2';
  if (normalized === 'P3') return 'P3';
  if (normalized === 'P4') return 'P4';
  return null;
};

const priorityFromSeverity = (severity: Ticket['severity']): NonNullable<Ticket['priority']> => {
  if (severity === 'critical') return 'P1';
  if (severity === 'high') return 'P2';
  if (severity === 'medium') return 'P3';
  return 'P4';
};

const parseWorkOrderStatus = (value: unknown): TaskOrder['status'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pending') return 'pending';
  if (normalized === 'in_progress') return 'in_progress';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'canceled') return 'canceled';
  return null;
};

const parseWorkOrderType = (value: unknown): TaskOrder['type'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'installation') return 'installation';
  if (normalized === 'repair') return 'repair';
  if (normalized === 'migration') return 'migration';
  if (normalized === 'reallocation') return 'reallocation';
  return null;
};

const appendTicketHistory = (ticket: Ticket, action: string, detail: string, createdBy?: string) => {
  ticket.history = ticket.history || [];
  ticket.history.unshift({
    id: 'th-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
    action,
    detail,
    createdAt: nowStamp(),
    createdBy,
  });
  ticket.updatedAt = nowStamp();
};

const appendWorkOrderHistory = (order: TaskOrder, action: string, detail: string, createdBy?: string) => {
  order.history = order.history || [];
  order.history.unshift({
    id: 'woh-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
    action,
    detail,
    createdAt: nowStamp(),
    createdBy,
  });
};

const updateRelatedClientOnCompletedOrder = (order: TaskOrder) => {
  const client = store.CLIENTS.find((c) => c.id === order.clientId);
  if (client && client.status === 'lead') {
    client.status = 'active';
    client.installationDate = new Date().toISOString().substring(0, 10);
    client.ip = `10.100.10.${Math.floor(Math.random() * 200) + 10}`;
    client.mac = `00:E0:4C:D1:A1:${Math.floor(Math.random() * 90) + 10}`;
    client.pppoeUser = `${client.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_nuga`;
    client.pppoePassword = 'DefaultSecurePassword';

    store.createAlert('client', 'info', client.name, 'Instalacion fisica concretada por Tecnico. Servicio activo.');
  }
};

router.get('/api/technicians', (_req, res) => {
  const byOrder = store.WORK_ORDERS.map((wo) => ({ id: wo.assignedTechnicianId || wo.technicianName.toLowerCase().replace(/[^a-z0-9]/g, '-'), name: wo.technicianName }));
  const byTicket = store.TICKETS.filter((tk) => !!tk.technicianName).map((tk) => ({ id: tk.technicianId || tk.technicianName!.toLowerCase().replace(/[^a-z0-9]/g, '-'), name: tk.technicianName! }));

  const unique = new Map<string, { id: string; name: string }>();
  [...byOrder, ...byTicket].forEach((row) => {
    if (!unique.has(row.id)) {
      unique.set(row.id, row);
    }
  });

  res.json(Array.from(unique.values()));
});

router.get('/api/tickets', (req, res) => {
  const status = parseTicketStatus(req.query.status);
  const severity = parseTicketSeverity(req.query.severity);
  const priority = parseTicketPriority(req.query.priority);
  const technicianId = String(req.query.technicianId || '').trim();
  const clientId = String(req.query.clientId || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();

  const rows = store.TICKETS.filter((ticket) => {
    const matchesStatus = !status || ticket.status === status;
    const matchesSeverity = !severity || ticket.severity === severity;
    const matchesPriority = !priority || ticket.priority === priority;
    const matchesTechnician = !technicianId || ticket.technicianId === technicianId;
    const matchesClient = !clientId || ticket.clientId === clientId;
    const matchesQ = !q
      || ticket.title.toLowerCase().includes(q)
      || ticket.clientName.toLowerCase().includes(q)
      || ticket.description.toLowerCase().includes(q);

    return matchesStatus && matchesSeverity && matchesPriority && matchesTechnician && matchesClient && matchesQ;
  });

  res.json(rows);
});

router.get('/api/tickets/:id', (req, res) => {
  const ticket = store.TICKETS.find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }
  return res.json(ticket);
});

router.post('/api/tickets', requireRoles(['super admin', 'administrador', 'soporte']), (req, res) => {
  const { clientId, title, description, category, severity, priority } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Missing required field: title' });
  }

  const client = store.CLIENTS.find((c) => c.id === clientId);
  const parsedSeverity = parseTicketSeverity(severity) || 'medium';
  const parsedCategory = parseTicketCategory(category) || 'Internet';
  const parsedPriority = parseTicketPriority(priority) || priorityFromSeverity(parsedSeverity);

  const createdAt = nowStamp();

  const newTicket: Ticket = {
    id: store.getUniqueTicketId(),
    clientName: client ? client.name : 'Cliente Generico',
    clientId,
    title,
    description: description || 'Sin descripcion',
    category: parsedCategory,
    severity: parsedSeverity,
    priority: parsedPriority,
    status: 'open',
    slaHours: parsedSeverity === 'critical' ? 1 : parsedSeverity === 'high' ? 4 : 24,
    created: createdAt,
    updatedAt: createdAt,
    messages: description ? [{ sender: 'Cliente', message: description, date: createdAt }] : [],
    attachments: [],
    history: [],
  };

  appendTicketHistory(newTicket, 'created', `Ticket creado con prioridad ${newTicket.priority} y severidad ${newTicket.severity}.`, 'system');
  store.TICKETS.unshift(newTicket);
  store.createAlert('system', 'warning', newTicket.clientName, `Nuevo ticket soporte: ${title}`);
  return res.status(201).json(newTicket);
});

router.put('/api/tickets/:id', requireRoles(['super admin', 'administrador', 'soporte']), (req, res) => {
  const ticket = store.TICKETS.find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  const patch: string[] = [];
  if (req.body.title !== undefined) {
    ticket.title = String(req.body.title);
    patch.push('titulo');
  }
  if (req.body.description !== undefined) {
    ticket.description = String(req.body.description);
    patch.push('descripcion');
  }
  if (req.body.category !== undefined) {
    const parsedCategory = parseTicketCategory(req.body.category);
    if (!parsedCategory) {
      return res.status(400).json({ error: 'Invalid category. Allowed: Internet, Facturacion, Instalacion, Falla Red, Otro' });
    }
    ticket.category = parsedCategory;
    patch.push('categoria');
  }

  if (req.body.severity !== undefined) {
    const parsedSeverity = parseTicketSeverity(req.body.severity);
    if (!parsedSeverity) {
      return res.status(400).json({ error: 'Invalid severity. Allowed: low, medium, high, critical' });
    }
    ticket.severity = parsedSeverity;
    ticket.slaHours = parsedSeverity === 'critical' ? 1 : parsedSeverity === 'high' ? 4 : 24;
    patch.push('severidad');
  }

  if (req.body.priority !== undefined) {
    const parsedPriority = parseTicketPriority(req.body.priority);
    if (!parsedPriority) {
      return res.status(400).json({ error: 'Invalid priority. Allowed: P1, P2, P3, P4' });
    }
    ticket.priority = parsedPriority;
    patch.push('prioridad');
  }

  if (req.body.status !== undefined) {
    const parsedStatus = parseTicketStatus(req.body.status);
    if (!parsedStatus) {
      return res.status(400).json({ error: 'Invalid status. Allowed: open, assigned, resolved, closed' });
    }
    ticket.status = parsedStatus;
    patch.push('estado');
  }

  if (req.body.technicianId !== undefined) {
    ticket.technicianId = String(req.body.technicianId || '');
    patch.push('tecnico_id');
  }
  if (req.body.technicianName !== undefined) {
    ticket.technicianName = String(req.body.technicianName || '');
    patch.push('tecnico_nombre');
  }

  if (patch.length > 0) {
    appendTicketHistory(ticket, 'updated', `Campos actualizados: ${patch.join(', ')}.`, 'support');
  }

  return res.json(ticket);
});

router.delete('/api/tickets/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const exists = store.TICKETS.some((item) => item.id === req.params.id);
  if (!exists) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  store.TICKETS = store.TICKETS.filter((item) => item.id !== req.params.id);
  return res.status(204).send();
});

router.post('/api/tickets/:id/assign', requireRoles(['super admin', 'administrador', 'soporte']), (req, res) => {
  const ticket = store.TICKETS.find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  const { technicianId, technicianName } = req.body;
  if (!technicianId && !technicianName) {
    return res.status(400).json({ error: 'Missing assignment data: technicianId or technicianName' });
  }

  ticket.technicianId = technicianId ? String(technicianId) : ticket.technicianId;
  ticket.technicianName = technicianName ? String(technicianName) : ticket.technicianName;
  ticket.status = 'assigned';
  appendTicketHistory(ticket, 'assigned', `Ticket asignado a ${ticket.technicianName || ticket.technicianId}.`, 'support');

  return res.json(ticket);
});

router.post('/api/tickets/:id/status', requireRoles(['super admin', 'administrador', 'soporte', 'tecnico']), (req, res) => {
  const ticket = store.TICKETS.find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  const status = parseTicketStatus(req.body.status);
  if (!status) {
    return res.status(400).json({ error: 'Invalid status. Allowed: open, assigned, resolved, closed' });
  }

  ticket.status = status;
  appendTicketHistory(ticket, 'status_change', `Estado actualizado a ${status}.`, 'support');
  return res.json(ticket);
});

router.post('/api/tickets/:id/message', requireRoles(['super admin', 'administrador', 'soporte', 'tecnico']), (req, res) => {
  const { id } = req.params;
  const { message, sender } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Missing required field: message' });
  }

  const ticket = store.TICKETS.find((t) => t.id === id);
  if (ticket) {
    ticket.messages.push({
      sender: sender || 'Soporte NugaCore',
      message,
      date: nowStamp(),
    });
    appendTicketHistory(ticket, 'comment', 'Nuevo comentario agregado al ticket.', sender || 'support');
    return res.json(ticket);
  } else {
    return res.status(404).json({ error: 'Ticket not found' });
  }
});

router.post('/api/tickets/:id/attachments', requireRoles(['super admin', 'administrador', 'soporte', 'tecnico']), (req, res) => {
  const ticket = store.TICKETS.find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  const { name, url, type, uploadedBy } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'Missing required fields: name, url' });
  }

  ticket.attachments = ticket.attachments || [];
  ticket.attachments.unshift({
    id: 'att-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
    name: String(name),
    url: String(url),
    type: type ? String(type) : undefined,
    uploadedAt: nowStamp(),
    uploadedBy: uploadedBy ? String(uploadedBy) : undefined,
  });
  appendTicketHistory(ticket, 'attachment', `Adjunto agregado: ${name}.`, uploadedBy || 'support');

  return res.status(201).json(ticket);
});

router.get('/api/tickets/:id/history', (req, res) => {
  const ticket = store.TICKETS.find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  return res.json(ticket.history || []);
});

router.get('/api/workorders/agenda', (req, res) => {
  const technicianId = String(req.query.technicianId || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const rows = store.WORK_ORDERS.filter((item) => {
    const agendaDate = item.date;
    const matchesTechnician = !technicianId || item.assignedTechnicianId === technicianId;
    const matchesFrom = !from || agendaDate >= from;
    const matchesTo = !to || agendaDate <= to;
    return matchesTechnician && matchesFrom && matchesTo;
  });

  const grouped = rows.reduce<Record<string, TaskOrder[]>>((acc, item) => {
    const key = item.date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const calendar = Object.keys(grouped)
    .sort()
    .map((date) => ({ date, count: grouped[date].length, workOrders: grouped[date] }));

  return res.json(calendar);
});

router.get('/api/workorders', (req, res) => {
  const status = parseWorkOrderStatus(req.query.status);
  const type = parseWorkOrderType(req.query.type);
  const technicianId = String(req.query.technicianId || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();

  const rows = store.WORK_ORDERS.filter((order) => {
    const matchesStatus = !status || order.status === status;
    const matchesType = !type || order.type === type;
    const matchesTech = !technicianId || order.assignedTechnicianId === technicianId;
    const matchesFrom = !dateFrom || order.date >= dateFrom;
    const matchesTo = !dateTo || order.date <= dateTo;
    const matchesQ = !q
      || order.title.toLowerCase().includes(q)
      || order.clientName.toLowerCase().includes(q)
      || order.address.toLowerCase().includes(q)
      || order.technicianName.toLowerCase().includes(q);

    return matchesStatus && matchesType && matchesTech && matchesFrom && matchesTo && matchesQ;
  });

  return res.json(rows);
});

router.get('/api/workorders/:id', (req, res) => {
  const order = store.WORK_ORDERS.find((item) => item.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Work order not found' });
  }
  return res.json(order);
});

router.post('/api/workorders', requireRoles(['super admin', 'administrador', 'soporte']), (req, res) => {
  const {
    title,
    type,
    clientId,
    address,
    phone,
    notes,
    date,
    technicianName,
    assignedTechnicianId,
    scheduledStart,
    scheduledEnd,
    checklist,
    status,
  } = req.body;

  if (!title || !clientId || !date) {
    return res.status(400).json({ error: 'Missing required fields: title, clientId, date' });
  }

  const client = store.CLIENTS.find((item) => item.id === clientId);
  if (!client) {
    return res.status(400).json({ error: 'Invalid clientId' });
  }

  const parsedType = parseWorkOrderType(type) || 'repair';
  const parsedStatus = parseWorkOrderStatus(status) || 'pending';
  const order: TaskOrder = {
    id: store.getUniqueWorkOrderId(),
    title: String(title),
    type: parsedType,
    clientName: client.name,
    clientId: client.id,
    address: address ? String(address) : client.address,
    phone: phone ? String(phone) : client.phone,
    notes: notes ? String(notes) : 'Sin notas',
    date: String(date),
    scheduledStart: scheduledStart ? String(scheduledStart) : undefined,
    scheduledEnd: scheduledEnd ? String(scheduledEnd) : undefined,
    assignedTechnicianId: assignedTechnicianId ? String(assignedTechnicianId) : undefined,
    technicianName: technicianName ? String(technicianName) : 'Tecnico por asignar',
    status: parsedStatus,
    checklist: Array.isArray(checklist)
      ? checklist.map((item: { item: unknown; done: unknown }) => ({ item: String(item.item || 'Actividad'), done: !!item.done }))
      : [],
    photos: [],
    evidences: [],
    history: [],
  };

  appendWorkOrderHistory(order, 'created', `Orden creada con estatus ${order.status}.`, 'support');
  store.WORK_ORDERS.unshift(order);
  return res.status(201).json(order);
});

router.put('/api/workorders/:id', requireRoles(['super admin', 'administrador', 'soporte', 'tecnico']), (req, res) => {
  const order = store.WORK_ORDERS.find((item) => item.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Work order not found' });
  }

  const patch: string[] = [];
  if (req.body.title !== undefined) {
    order.title = String(req.body.title);
    patch.push('titulo');
  }
  if (req.body.notes !== undefined) {
    order.notes = String(req.body.notes);
    patch.push('notas');
  }
  if (req.body.address !== undefined) {
    order.address = String(req.body.address);
    patch.push('direccion');
  }
  if (req.body.phone !== undefined) {
    order.phone = String(req.body.phone);
    patch.push('telefono');
  }
  if (req.body.date !== undefined) {
    order.date = String(req.body.date);
    patch.push('fecha');
  }
  if (req.body.scheduledStart !== undefined) {
    order.scheduledStart = req.body.scheduledStart ? String(req.body.scheduledStart) : undefined;
    patch.push('agenda_inicio');
  }
  if (req.body.scheduledEnd !== undefined) {
    order.scheduledEnd = req.body.scheduledEnd ? String(req.body.scheduledEnd) : undefined;
    patch.push('agenda_fin');
  }
  if (req.body.technicianName !== undefined) {
    order.technicianName = String(req.body.technicianName || 'Tecnico por asignar');
    patch.push('tecnico_nombre');
  }
  if (req.body.assignedTechnicianId !== undefined) {
    order.assignedTechnicianId = req.body.assignedTechnicianId ? String(req.body.assignedTechnicianId) : undefined;
    patch.push('tecnico_id');
  }
  if (req.body.type !== undefined) {
    const parsedType = parseWorkOrderType(req.body.type);
    if (!parsedType) {
      return res.status(400).json({ error: 'Invalid type. Allowed: installation, repair, migration, reallocation' });
    }
    order.type = parsedType;
    patch.push('tipo');
  }
  if (req.body.status !== undefined) {
    const parsedStatus = parseWorkOrderStatus(req.body.status);
    if (!parsedStatus) {
      return res.status(400).json({ error: 'Invalid status. Allowed: pending, in_progress, completed, canceled' });
    }
    order.status = parsedStatus;
    if (parsedStatus === 'completed') {
      updateRelatedClientOnCompletedOrder(order);
    }
    patch.push('estado');
  }
  if (req.body.checklist !== undefined) {
    if (!Array.isArray(req.body.checklist)) {
      return res.status(400).json({ error: 'Invalid checklist payload' });
    }
    order.checklist = req.body.checklist.map((item: { item: unknown; done: unknown }) => ({
      item: String(item.item || 'Actividad'),
      done: !!item.done,
    }));
    patch.push('checklist');
  }

  if (patch.length > 0) {
    appendWorkOrderHistory(order, 'updated', `Campos actualizados: ${patch.join(', ')}.`, 'support');
  }

  return res.json(order);
});

router.delete('/api/workorders/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const exists = store.WORK_ORDERS.some((item) => item.id === req.params.id);
  if (!exists) {
    return res.status(404).json({ error: 'Work order not found' });
  }

  store.WORK_ORDERS = store.WORK_ORDERS.filter((item) => item.id !== req.params.id);
  return res.status(204).send();
});

router.post('/api/workorders/:id/checklist/:index/toggle', requireRoles(['super admin', 'administrador', 'soporte', 'tecnico']), (req, res) => {
  const order = store.WORK_ORDERS.find((item) => item.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Work order not found' });
  }

  const index = Number(req.params.index);
  if (Number.isNaN(index) || index < 0 || index >= order.checklist.length) {
    return res.status(400).json({ error: 'Invalid checklist index' });
  }

  order.checklist[index].done = !order.checklist[index].done;
  appendWorkOrderHistory(order, 'checklist', `Checklist actualizado en item ${index + 1}.`, 'technician');
  return res.json(order);
});

router.post('/api/workorders/:id/evidences', requireRoles(['super admin', 'administrador', 'soporte', 'tecnico']), (req, res) => {
  const order = store.WORK_ORDERS.find((item) => item.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Work order not found' });
  }

  const { kind, url, uploadedBy, notes } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing required field: url' });
  }

  const resolvedKind = String(kind || 'photo').toLowerCase() === 'document' ? 'document' : 'photo';
  order.evidences = order.evidences || [];
  order.evidences.unshift({
    id: 'woe-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
    kind: resolvedKind,
    url: String(url),
    uploadedAt: nowStamp(),
    uploadedBy: uploadedBy ? String(uploadedBy) : undefined,
    notes: notes ? String(notes) : undefined,
  });

  order.photos = order.photos || [];
  if (resolvedKind === 'photo') {
    order.photos.unshift(String(url));
  }

  appendWorkOrderHistory(order, 'evidence', `Evidencia agregada (${resolvedKind}).`, uploadedBy || 'technician');
  return res.status(201).json(order);
});

router.post('/api/workorders/:id/update-status', requireRoles(['super admin', 'administrador', 'soporte', 'tecnico']), (req, res) => {
  const { id } = req.params;
  const { status, signature, checklist } = req.body;
  const order = store.WORK_ORDERS.find((w) => w.id === id);
  if (order) {
    const parsedStatus = parseWorkOrderStatus(status);
    if (!parsedStatus) {
      return res.status(400).json({ error: 'Invalid status. Allowed: pending, in_progress, completed, canceled' });
    }

    order.status = parsedStatus;
    if (signature) order.signature = signature;
    if (Array.isArray(checklist)) {
      order.checklist = checklist.map((item: { item: unknown; done: unknown }) => ({
        item: String(item.item || 'Actividad'),
        done: !!item.done,
      }));
    }

    appendWorkOrderHistory(order, 'status_change', `Estado actualizado a ${parsedStatus}.`, 'technician');

    if (parsedStatus === 'completed') {
      updateRelatedClientOnCompletedOrder(order);
    }

    return res.json(order);
  } else {
    return res.status(404).json({ error: 'Work order not found' });
  }
});

export default router;

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { NotFoundError } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getSupportService } from './service';
import { getSlaRules, listSlaBreachesFromSupport } from './sla';

const router = Router();
const svc = () => getSupportService();

const WRITE_TICKET_ROLES = ['super admin', 'administrador', 'soporte'] as const;
const WRITE_WO_ROLES = ['super admin', 'administrador', 'soporte'] as const;
const TECH_ROLES = ['super admin', 'administrador', 'soporte', 'tecnico'] as const;

router.get('/api/technicians', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await svc().listTechnicians());
}));

router.get('/api/tickets/sla/breaches', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json({ rules: getSlaRules(), breaches: await listSlaBreachesFromSupport() });
}));

router.get('/api/tickets', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await svc().listTickets(req.query as Record<string, unknown>));
}));

router.get('/api/tickets/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const ticket = await svc().getTicket(req.params.id);
  if (!ticket) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
  res.json(ticket);
}));

router.post('/api/tickets', requireRoles([...WRITE_TICKET_ROLES]), asyncHandler(async (req, res) => {
  const created = await svc().createTicket(req.body || {});
  res.status(201).json(created);
}));

router.put('/api/tickets/:id', requireRoles([...WRITE_TICKET_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().updateTicket(req.params.id, req.body || {}));
}));

router.delete('/api/tickets/:id', requireRoles(['super admin', 'administrador']), asyncHandler(async (req, res) => {
  const ok = await svc().deleteTicket(req.params.id);
  if (!ok) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
  res.status(204).send();
}));

router.post('/api/tickets/:id/assign', requireRoles([...WRITE_TICKET_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().assignTicket(req.params.id, req.body || {}));
}));

router.post('/api/tickets/:id/status', requireRoles([...TECH_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().setTicketStatus(req.params.id, req.body || {}));
}));

router.post('/api/tickets/:id/message', requireRoles([...TECH_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().addTicketMessage(req.params.id, req.body || {}));
}));

router.post('/api/tickets/:id/attachments', requireRoles([...TECH_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().addTicketAttachment(req.params.id, req.body || {}));
}));

router.get('/api/tickets/:id/history', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const ticket = await svc().getTicket(req.params.id);
  if (!ticket) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
  res.json(await svc().getTicketHistory(req.params.id));
}));

router.get('/api/workorders/agenda', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await svc().getWorkOrderAgenda(req.query as Record<string, unknown>));
}));

router.get('/api/workorders', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await svc().listWorkOrders(req.query as Record<string, unknown>));
}));

router.get('/api/workorders/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const order = await svc().getWorkOrder(req.params.id);
  if (!order) throw new NotFoundError('Work order not found', 'NOT_FOUND');
  res.json(order);
}));

router.post('/api/workorders', requireRoles([...WRITE_WO_ROLES]), asyncHandler(async (req, res) => {
  const created = await svc().createWorkOrder(req.body || {});
  res.status(201).json(created);
}));

router.put('/api/workorders/:id', requireRoles([...WRITE_WO_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().updateWorkOrder(req.params.id, req.body || {}));
}));

router.delete('/api/workorders/:id', requireRoles(['super admin', 'administrador']), asyncHandler(async (req, res) => {
  const ok = await svc().deleteWorkOrder(req.params.id);
  if (!ok) throw new NotFoundError('Work order not found', 'NOT_FOUND');
  res.status(204).send();
}));

router.post('/api/workorders/:id/checklist/:index/toggle', requireRoles([...TECH_ROLES]), asyncHandler(async (req, res) => {
  const index = Number.parseInt(req.params.index, 10);
  res.json(await svc().toggleChecklistItem(req.params.id, index));
}));

router.post('/api/workorders/:id/update-status', requireRoles([...TECH_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().updateWorkOrderStatus(req.params.id, req.body || {}));
}));

router.post('/api/workorders/:id/status', requireRoles([...TECH_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().updateWorkOrderStatus(req.params.id, req.body || {}));
}));

router.post('/api/workorders/:id/evidences', requireRoles([...TECH_ROLES]), asyncHandler(async (req, res) => {
  res.json(await svc().addWorkOrderEvidence(req.params.id, req.body || {}));
}));

router.post('/api/workorders/sync-batch', requireRoles([...TECH_ROLES]), asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items as Array<{ orderId: string; action: string; payload?: Record<string, unknown> }> : [];
  const results: Array<{ orderId: string; action: string; ok: boolean }> = [];
  for (const item of items) {
    try {
      if (item.action === 'status') {
        await svc().updateWorkOrderStatus(item.orderId, item.payload || {});
      } else if (item.action === 'evidence') {
        await svc().addWorkOrderEvidence(item.orderId, item.payload || {});
      } else if (item.action === 'checklist') {
        await svc().toggleChecklistItem(item.orderId, Number(item.payload?.index ?? 0));
      }
      results.push({ orderId: item.orderId, action: item.action, ok: true });
    } catch {
      results.push({ orderId: item.orderId, action: item.action, ok: false });
    }
  }
  res.json({ synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}));

export default router;

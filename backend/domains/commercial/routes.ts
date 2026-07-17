import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { NotFoundError } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import type { CommercialStage } from './types';
import { getCommercialService } from './service';

const router = Router();
const WRITE_ROLES = ['super admin', 'administrador', 'soporte', 'cobranza'] as const;
const svc = () => getCommercialService();

router.get('/api/commercial/pipeline', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await svc().getPipelineSummary(tenantIdFromRequest(req)));
}));

router.get('/api/commercial/prospects', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const rows = await svc().listProspects({
    stage: req.query.stage ? String(req.query.stage) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
    tenantId: tenantIdFromRequest(req),
  });
  res.json(rows);
}));

router.get('/api/commercial/prospects/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const row = await svc().getProspect(req.params.id, tenantIdFromRequest(req));
  if (!row) throw new NotFoundError('Prospect not found', 'NOT_FOUND');
  res.json(row);
}));

router.post('/api/commercial/prospects', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const created = await svc().createProspect(req.body || {}, tenantIdFromRequest(req));
  res.status(201).json(created);
}));

router.post('/api/commercial/prospects/:id/advance', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const stage = String(req.body?.stage || '') as CommercialStage;
  res.json(await svc().advanceProspectStage(req.params.id, stage, tenantIdFromRequest(req)));
}));

router.post('/api/commercial/prospects/:id/convert', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  res.status(201).json(await svc().convertProspectToClient(req.params.id, tenantIdFromRequest(req)));
}));

router.get('/api/commercial/quotes', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await svc().listQuotes({
    prospectId: req.query.prospectId ? String(req.query.prospectId) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    tenantId: tenantIdFromRequest(req),
  }));
}));

router.post('/api/commercial/quotes', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const created = await svc().createQuote(req.body || {}, tenantIdFromRequest(req));
  res.status(201).json(created);
}));

router.get('/api/commercial/appointments', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await svc().listAppointments({
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    technicianId: req.query.technicianId ? String(req.query.technicianId) : undefined,
    tenantId: tenantIdFromRequest(req),
  }));
}));

router.post('/api/commercial/appointments', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const created = await svc().createAppointment(req.body || {}, tenantIdFromRequest(req));
  res.status(201).json(created);
}));

export default router;

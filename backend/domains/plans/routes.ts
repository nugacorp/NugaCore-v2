import { Router } from 'express';
import { AppRole, READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { PlanRecord } from './mappers';
import { getPlansService } from './service';

const router = Router();

// Persistencia detrás de feature flag USE_DB_PLANS (store mock | Supabase).
// El contrato de API v1 (rutas, payloads, formas de respuesta) NO cambia.
//
// RBAC (TAREA 5): lectura para todos los roles; escritura solo super admin
// y administrador. Coincide con el esquema previo y con lo solicitado.
const WRITE_ROLES: AppRole[] = ['super admin', 'administrador'];

router.get('/api/plans', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const businessType = String(req.query.businessType || '').trim().toLowerCase();

  const rows = await getPlansService().list({ q, status, businessType });
  res.json(rows);
}));

router.get('/api/plans/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const plan = await getPlansService().getById(req.params.id);
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  res.json(plan);
}));

router.post('/api/plans', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const service = getPlansService();

  // Validación + normalización (lanza 400 si es inválida).
  const validated = service.validateCreate(req.body);

  // Nombre único (lanza 409 si ya existe).
  await service.assertNameAvailable(validated.name);

  const record: PlanRecord = { id: await service.generatePlanId(), ...validated };
  const created = await service.create(record);

  res.status(201).json(created);
}));

router.put('/api/plans/:id', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const service = getPlansService();

  const existing = await service.getById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  // Validación + construcción del patch (solo claves presentes; lanza 400 si inválido).
  const patch = service.buildUpdatePatch(req.body);

  const updated = await service.update(req.params.id, patch);
  if (!updated) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  res.json(updated);
}));

router.delete('/api/plans/:id', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const service = getPlansService();

  // El plan no se puede borrar si algún cliente lo usa (contrato v1: 409).
  if (await service.isInUse(req.params.id)) {
    return res.status(409).json({ error: 'Plan is in use by at least one client' });
  }

  const removed = await service.remove(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  res.status(204).send();
}));

export default router;

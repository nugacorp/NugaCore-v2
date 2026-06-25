// ====================================================================
// Automation routes (PROD-8).
//
// Solo lectura + simulacion. FASE N: todos los roles autenticados tienen
// acceso de lectura y de simulacion (dry-run). NADIE modifica reglas
// todavia: no se exponen endpoints de escritura sobre reglas.
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { automationService } from './service';
import { listAudit } from './audit';

const router = Router();

const actorOf = (req: { authContext?: { userId: string } }): string => req.authContext?.userId ?? 'unknown';

router.get('/api/automation/rules', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(automationService.listRules());
}));

router.get('/api/automation/rules/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(automationService.getRule(req.params.id));
}));

router.get('/api/automation/events', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(automationService.listEvents());
}));

router.get('/api/automation/decisions', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : '';
  res.json(customerId ? automationService.decisionsForCustomer(customerId) : automationService.listDecisions());
}));

router.get('/api/automation/audit', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(listAudit());
}));

router.get('/api/automation/summary', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(automationService.summary());
}));

// Simulacion dry-run: recibe { event, customerId, payload } y devuelve
// { rulesMatched, decisions, executionPreview, dryRun:true }. Nunca ejecuta.
router.post('/api/automation/simulate', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(automationService.simulate(req.body ?? {}, actorOf(req)));
}));

export default router;

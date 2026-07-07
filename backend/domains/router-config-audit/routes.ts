import { Router } from 'express';
import { asyncHandler, BadRequestError } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { createRouterBackup, diffRouterBackups, listRouterBackups } from './service';
import { getCustomersService } from '../customers/service';

const router = Router();
const WRITE = ['super admin', 'administrador'] as const;

router.get('/api/mikrotik/:routerId/backups', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(listRouterBackups(req.params.routerId));
}));

router.post('/api/mikrotik/:routerId/backups', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const content = String(req.body?.content || '').trim();
  if (!content) throw new BadRequestError('content required (dry-run backup)', 'MISSING_FIELD');
  res.status(201).json(createRouterBackup({
    routerId: req.params.routerId,
    backupType: req.body?.backupType === 'binary' ? 'binary' : 'export',
    content,
    createdBy: req.authContext?.userId,
  }));
}));

router.get('/api/mikrotik/backups/diff', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const a = String(req.query.a || '');
  const b = String(req.query.b || '');
  if (!a || !b) throw new BadRequestError('query params a and b required', 'MISSING_FIELD');
  res.json(diffRouterBackups(a, b));
}));

router.post('/api/mikrotik/:routerId/operations/preview', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const op = String(req.body?.operation || 'queue_suspend');
  const clientId = req.body?.clientId ? String(req.body.clientId) : undefined;
  const client = clientId ? await getCustomersService().getById(clientId) : null;
  res.json({
    routerId: req.params.routerId,
    operation: op,
    dryRun: true,
    gated: true,
    preview: {
      method: op.includes('hotspot') ? 'hotspot' : op.includes('pppoe') ? 'pppoe' : op.includes('address') ? 'address-list' : 'simple-queue',
      target: client ? { clientId: client.id, name: client.name, ip: client.ip } : null,
      commands: [`# PREVIEW ONLY — ${op}`, '/queue simple disable [find name=...]'],
    },
    note: 'Ejecución real bloqueada hasta PROD-7+. Ver ROADMAP gates.',
  });
}));

export default router;

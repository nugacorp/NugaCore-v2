import { Router } from 'express';
import { listPermissionMatrix } from '../../common/action-permissions';
import { requireAction } from '../../common/rbac';
import { store } from '../../state/store';

const router = Router();

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

const looksEncrypted = (payload: string | undefined): boolean => {
  if (!payload) return false;
  const parts = payload.split('.');
  if (parts.length !== 3) return false;
  return parts.every((part) => part.length > 10);
};

router.get('/api/security/audit-logs', requireAction('security.audit.read'), (req, res) => {
  const method = String(req.query.method || '').trim().toUpperCase();
  const actorId = String(req.query.actorId || '').trim();
  const success = String(req.query.success || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));

  const rows = store.SECURITY_AUDIT_LOGS
    .filter((row) => {
      const matchesMethod = !method || row.method === method;
      const matchesActor = !actorId || row.actorId === actorId;
      const matchesSuccess = !success || (success === 'true' ? row.success : !row.success);
      return matchesMethod && matchesActor && matchesSuccess;
    })
    .slice(0, limit);

  res.json(rows);
});

router.get('/api/security/permission-matrix', requireAction('security.permissions.read'), (_req, res) => {
  res.json({
    generatedAt: nowStamp(),
    matrix: listPermissionMatrix(),
  });
});

router.get('/api/security/backup-policy', requireAction('security.backup.manage'), (_req, res) => {
  res.json(store.BACKUP_POLICY);
});

router.put('/api/security/backup-policy', requireAction('security.backup.manage'), (req, res) => {
  const { enabled, frequency, retentionDays, encrypted, location } = req.body;

  if (enabled !== undefined) store.BACKUP_POLICY.enabled = Boolean(enabled);
  if (frequency !== undefined) {
    const normalized = String(frequency).toLowerCase();
    if (normalized !== 'daily' && normalized !== 'weekly' && normalized !== 'monthly') {
      return res.status(400).json({ error: 'Invalid frequency. Allowed: daily, weekly, monthly.' });
    }
    store.BACKUP_POLICY.frequency = normalized;
  }
  if (retentionDays !== undefined) {
    const parsed = Number(retentionDays);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) {
      return res.status(400).json({ error: 'Invalid retentionDays. Allowed range: 1 to 3650.' });
    }
    store.BACKUP_POLICY.retentionDays = parsed;
  }
  if (encrypted !== undefined) store.BACKUP_POLICY.encrypted = Boolean(encrypted);
  if (location !== undefined) store.BACKUP_POLICY.location = String(location);

  res.json(store.BACKUP_POLICY);
});

router.post('/api/security/backup/run', requireAction('security.backup.manage'), (req, res) => {
  if (!store.BACKUP_POLICY.enabled) {
    return res.status(400).json({ error: 'Backup policy is disabled.' });
  }

  store.BACKUP_POLICY.lastBackupAt = nowStamp();
  store.logSecurityAudit({
    actorId: req.authContext?.userId,
    actorRole: req.authContext?.role,
    action: 'backup.run',
    resource: '/api/security/backup/run',
    method: 'POST',
    statusCode: 200,
    success: true,
    source: req.ip || 'local',
    metadata: `frequency=${store.BACKUP_POLICY.frequency}; encrypted=${store.BACKUP_POLICY.encrypted}`,
  });

  res.json({
    status: 'ok',
    executedAt: store.BACKUP_POLICY.lastBackupAt,
    policy: store.BACKUP_POLICY,
  });
});

router.get('/api/security/secrets/status', requireAction('security.audit.read'), (_req, res) => {
  const totalRouters = store.MIKROTIK_ROUTERS.length;
  const encryptedRouters = store.MIKROTIK_ROUTERS.filter((router) => looksEncrypted(router.encryptedPassword)).length;

  res.json({
    generatedAt: nowStamp(),
    encryptedSecrets: {
      totalRouters,
      encryptedRouters,
      coveragePct: totalRouters > 0 ? Number(((encryptedRouters / totalRouters) * 100).toFixed(2)) : 100,
    },
    credentialsKeyConfigured: Boolean(process.env.MIKROTIK_CREDENTIALS_KEY),
  });
});

export default router;

import { store } from '../../state/store';

/** SSOT read-only para logs de auditoría (store hasta USE_DB_SECURITY). */
export function listSecurityAuditLogs(limit = 200) {
  return store.SECURITY_AUDIT_LOGS.slice(0, Math.max(1, Math.min(500, limit)));
}

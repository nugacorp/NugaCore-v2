import { store } from '../../state/store';
import { createHash } from 'crypto';

export interface RouterBackupRecord {
  id: string;
  routerId: string;
  backupType: 'export' | 'binary';
  contentHash: string;
  contentPreview: string;
  sizeBytes: number;
  createdBy?: string;
  createdAt: string;
}

const memory: RouterBackupRecord[] = [];

const uid = () => `rbk-${Date.now()}`;

export function listRouterBackups(routerId?: string) {
  return routerId ? memory.filter((b) => b.routerId === routerId) : [...memory];
}

export function createRouterBackup(input: {
  routerId: string;
  backupType?: 'export' | 'binary';
  content: string;
  createdBy?: string;
}): RouterBackupRecord {
  const router = store.MIKROTIK_ROUTERS.find((r) => r.id === input.routerId);
  if (!router) throw new Error('Router not found');
  const contentHash = createHash('sha256').update(input.content).digest('hex');
  const record: RouterBackupRecord = {
    id: uid(),
    routerId: input.routerId,
    backupType: input.backupType ?? 'export',
    contentHash,
    contentPreview: input.content.substring(0, 500),
    sizeBytes: Buffer.byteLength(input.content, 'utf8'),
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  };
  memory.unshift(record);
  return record;
}

export function diffRouterBackups(backupIdA: string, backupIdB: string) {
  const a = memory.find((b) => b.id === backupIdA);
  const b = memory.find((b) => b.id === backupIdB);
  if (!a || !b) throw new Error('Backup not found');
  const linesA = a.contentPreview.split('\n');
  const linesB = b.contentPreview.split('\n');
  const added = linesB.filter((l) => !linesA.includes(l));
  const removed = linesA.filter((l) => !linesB.includes(l));
  return {
    backupA: backupIdA,
    backupB: backupIdB,
    hashChanged: a.contentHash !== b.contentHash,
    addedLines: added.slice(0, 20),
    removedLines: removed.slice(0, 20),
    note: 'Diff basado en preview; backup live gated por MIKROTIK_WORKER_LIVE.',
  };
}

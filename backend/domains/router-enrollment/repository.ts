// ====================================================================
// Repositorio en memoria para Router Enrollment (Fase 4.7).
// ====================================================================

import { RouterEnrollmentRecord } from './types';

const RECORDS: RouterEnrollmentRecord[] = [];
let _counter = 0;

const nowIso = () => new Date().toISOString();

function nextId(): string {
  _counter++;
  let n = _counter;
  const ids = new Set(RECORDS.map((r) => r.id));
  while (ids.has(`enr-${n}`)) n++;
  return `enr-${n}`;
}

export const enrollmentRepository = {
  create(rec: RouterEnrollmentRecord): RouterEnrollmentRecord {
    RECORDS.unshift(rec);
    return rec;
  },

  getById(id: string): RouterEnrollmentRecord | undefined {
    return RECORDS.find((r) => r.id === id);
  },

  list(): RouterEnrollmentRecord[] {
    return [...RECORDS];
  },

  update(id: string, patch: Partial<RouterEnrollmentRecord>): RouterEnrollmentRecord | undefined {
    const idx = RECORDS.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    RECORDS[idx] = { ...RECORDS[idx], ...patch, updatedAt: nowIso() };
    return RECORDS[idx];
  },

  nextId,

  /** Solo para tests: limpia el repositorio. */
  _reset(): void {
    RECORDS.length = 0;
    _counter = 0;
  },
};

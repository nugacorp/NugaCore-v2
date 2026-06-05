// ====================================================================
// Store en memoria del Worker MikroTik (Fase 4.6) — bitácora de corridas.
// Solo metadata segura (sin credenciales, sin scripts). No persiste en DB
// (el worker es read-only/dry-run; el log vive en proceso).
// ====================================================================

import { WorkerRun } from './types';

let runSeq = 1;

export const workerStore = {
  RUNS: [] as WorkerRun[],

  nextRunId(): string {
    return `wrun-${runSeq++}`;
  },

  record(run: WorkerRun): WorkerRun {
    this.RUNS.unshift(run);
    if (this.RUNS.length > 200) this.RUNS.pop();
    return run;
  },

  reset(): void {
    this.RUNS = [];
    runSeq = 1;
  },
};

// ====================================================================
// Tipos del Worker MikroTik (Fase 4.6 — Read Only + Dry Run).
// ====================================================================

export type WorkerMode = 'live' | 'simulated';

/** Comandos RouterOS de SOLO LECTURA permitidos para el conector real. */
export const READ_ONLY_COMMANDS = [
  '/system/resource/print',
  '/interface/print',
  '/queue/simple/print',
  '/ppp/secret/print',
  '/ppp/active/print',
  '/ip/address/print',
] as const;

export type ReadOnlyCommand = (typeof READ_ONLY_COMMANDS)[number];

export interface RouterReadResult {
  command: string;
  ok: boolean;
  source: WorkerMode;
  /** Texto crudo (o serializado) de la lectura. */
  data: string;
  error?: string;
}

export interface RouterSnapshot {
  routerId: string;
  routerName: string;
  generatedAt: string;
  source: WorkerMode;
  reads: RouterReadResult[];
}

/** Resultado de "procesar" UNA orden en dry-run (no ejecuta nada real). */
export interface OrderProcessResult {
  orderId: string;
  orderType: 'suspension' | 'reactivation';
  customerId: string;
  dryRun: true;
  outcome: 'simulated' | 'skipped' | 'failed';
  /** Comandos RouterOS que se EJECUTARÍAN (no se envían). Sin secretos. */
  plannedCommands: string[];
  targetRouterId?: string;
  note: string;
}

export interface WorkerRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: WorkerMode;
  dryRun: true;
  pendingFound: number;
  processed: number;
  results: OrderProcessResult[];
  actorId?: string;
}

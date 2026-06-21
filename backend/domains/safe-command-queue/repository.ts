// ====================================================================
// Repositorio Safe Command Queue — store en memoria (síncrono).
//
// NO usa Supabase, NO crea tablas, NO crea migraciones. Mismo patrón que los
// demás dominios foundation. Expone `_reset()` para los tests.
// ====================================================================

import { SafeCommand, SafeCommandAudit } from './types';

const COMMANDS: SafeCommand[] = [];
const AUDITS: SafeCommandAudit[] = [];

let commandCounter = 0;
let auditCounter = 0;

const nextCommandId = (): string => {
  commandCounter += 1;
  const ids = new Set(COMMANDS.map((c) => c.id));
  let n = commandCounter;
  while (ids.has(`scq-${n}`)) n += 1;
  commandCounter = n;
  return `scq-${n}`;
};

const nextAuditId = (): string => {
  auditCounter += 1;
  return `scqa-${auditCounter}`;
};

export const safeCommandQueueRepository = {
  create(command: SafeCommand): SafeCommand {
    COMMANDS.unshift(command);
    return command;
  },

  list(): SafeCommand[] {
    return [...COMMANDS];
  },

  getById(id: string): SafeCommand | undefined {
    return COMMANDS.find((c) => c.id === id);
  },

  update(id: string, patch: Partial<SafeCommand>): SafeCommand | undefined {
    const idx = COMMANDS.findIndex((c) => c.id === id);
    if (idx === -1) return undefined;
    COMMANDS[idx] = { ...COMMANDS[idx], ...patch };
    return COMMANDS[idx];
  },

  appendAudit(entry: SafeCommandAudit): SafeCommandAudit {
    AUDITS.push(entry);
    return entry;
  },

  listAudits(commandId: string): SafeCommandAudit[] {
    return AUDITS.filter((a) => a.commandId === commandId).sort((a, b) =>
      a.timestamp === b.timestamp ? a.id.localeCompare(b.id) : a.timestamp.localeCompare(b.timestamp),
    );
  },

  nextCommandId,
  nextAuditId,

  /** Solo para tests: limpia el store. */
  _reset(): void {
    COMMANDS.length = 0;
    AUDITS.length = 0;
    commandCounter = 0;
    auditCounter = 0;
  },
};

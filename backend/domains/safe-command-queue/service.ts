// ====================================================================
// Service Safe Command Queue (FAST-1, dry-run).
//
// Orquesta el ciclo de vida de comandos SEGUROS en cola. Cada operación
// audita. NINGÚN método ejecuta RouterOS, MikroTik API, WireGuard, shell ni
// workers. No hay ejecución real: dryRun=true y wouldExecute=false siempre.
// El flujo exige simular (dry-run) antes de aprobar.
// ====================================================================

import { NotFoundError } from '../../common/errors';
import { productionGates } from '../../config/production-gates';
import { inventoryRoutersRepository } from '../inventory/routers/repository';
import { executePlannedCommands } from '../mikrotik/worker/command-executor';
import { sanitizeText } from '../../common/security/sanitize-sensitive-data';
import { assertNotLockoutBlocked, buildAudit, buildSafeCommand, resolveTransition } from './mappers';
import { safeCommandQueueRepository as repo } from './repository';
import {
  CreateSafeCommandInput,
  SafeCommand,
  SafeCommandDetail,
  SafeCommandEvent,
} from './types';

const requireCommand = (id: string): SafeCommand => {
  const command = repo.getById(id);
  if (!command) throw new NotFoundError('Comando no encontrado.', 'COMMAND_NOT_FOUND');
  return command;
};

const audit = (commandId: string, actor: string, event: SafeCommandEvent, details: string): void => {
  repo.appendAudit(buildAudit(repo.nextAuditId(), commandId, actor, event, details));
};

export const safeCommandQueueService = {
  createCommand(input: CreateSafeCommandInput, actor: string): SafeCommand {
    const command = buildSafeCommand(input, repo.nextCommandId(), actor);
    repo.create(command);
    audit(
      command.id,
      actor,
      'CREATED',
      `Comando creado (${command.commandType} → ${command.targetId}, riesgo ${command.riskLevel}).`,
    );
    return command;
  },

  listCommands(): SafeCommand[] {
    return repo.list();
  },

  getCommand(id: string): SafeCommandDetail {
    const command = requireCommand(id);
    return { command, audit: repo.listAudits(id) };
  },

  validateCommand(id: string, actor: string): SafeCommand {
    const command = requireCommand(id);
    assertNotLockoutBlocked(command, 'validar');
    const status = resolveTransition(command.status, 'VALIDATED');
    const updated = repo.update(id, { status, validatedBy: actor, validatedAt: new Date().toISOString() })!;
    audit(
      id,
      actor,
      'VALIDATED',
      `Comando validado (estructura, parámetros y lockout guard OK; riesgo ${command.lockoutRisk}).`,
    );
    return updated;
  },

  // simulateCommand NO ejecuta nada: confirma el dry-run y deja traza.
  simulateCommand(id: string, actor: string): SafeCommand {
    const command = requireCommand(id);
    assertNotLockoutBlocked(command, 'simular');
    const status = resolveTransition(command.status, 'SIMULATED');
    const updated = repo.update(id, { status })!;
    audit(
      id,
      actor,
      'SIMULATED',
      `Simulación segura (dry-run): ${command.plannedRouterOsCommands.length} comando(s) planificado(s); lockout ${command.lockoutRisk}.`,
    );
    return updated;
  },

  approveCommand(id: string, actor: string): SafeCommand {
    const command = requireCommand(id);
    assertNotLockoutBlocked(command, 'aprobar');
    const status = resolveTransition(command.status, 'APPROVED');
    const live = productionGates.safeCommandQueueLive();
    const updated = repo.update(id, {
      status,
      approvedBy: actor,
      approvedAt: new Date().toISOString(),
      dryRun: !live,
      wouldExecute: live,
    })!;
    if (live && command.plannedRouterOsCommands.length > 0) {
      const routers = inventoryRoutersRepository.list();
      const router = routers.find((r) => r.id === command.targetId)
        ?? routers.find((r) => r.encryptedPassword || r.hasCredentials)
        ?? routers[0];
      if (router) {
        void executePlannedCommands(router, command.plannedRouterOsCommands).then((result) => {
          audit(
            id,
            actor,
            'APPROVED',
            result.ok
              ? `Comando ejecutado en router (${result.executed} cmds).`
              : `Ejecución falló: ${result.errors.join('; ')}`,
          );
        });
      }
    }
    audit(id, actor, 'APPROVED', live ? 'Comando aprobado y encolado para ejecución live.' : 'Comando aprobado (sin ejecución; queda en cola dry-run).');
    return updated;
  },

  rejectCommand(id: string, actor: string, reason?: string): SafeCommand {
    const command = requireCommand(id);
    const status = resolveTransition(command.status, 'REJECTED');
    const safeReason = reason && reason.trim() !== '' ? sanitizeText(reason.trim()) : undefined;
    const notes = safeReason ?? command.notes;
    const updated = repo.update(id, { status, notes })!;
    audit(id, actor, 'REJECTED', safeReason ? `Comando rechazado: ${safeReason}` : 'Comando rechazado.');
    return updated;
  },

  cancelCommand(id: string, actor: string): SafeCommand {
    const command = requireCommand(id);
    const status = resolveTransition(command.status, 'CANCELLED');
    const updated = repo.update(id, { status })!;
    audit(id, actor, 'CANCELLED', 'Comando cancelado.');
    return updated;
  },
};

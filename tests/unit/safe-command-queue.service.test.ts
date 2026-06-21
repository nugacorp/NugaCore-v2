import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { safeCommandQueueService } from '../../backend/domains/safe-command-queue/service';
import { safeCommandQueueRepository } from '../../backend/domains/safe-command-queue/repository';

// ====================================================================
// FAST-1 Safe Command Queue — lógica del service (sin HTTP, sin ejecución).
// ====================================================================

const ACTOR = 'tester';

const create = (over: Record<string, unknown> = {}) =>
  safeCommandQueueService.createCommand(
    {
      commandType: 'UPDATE_QUEUE',
      targetId: 'cust-1',
      description: 'ajuste de cola',
      payload: { mbps: 50 },
      ...over,
    },
    ACTOR,
  );

describe('safeCommandQueueService', () => {
  beforeEach(() => safeCommandQueueRepository._reset());
  afterEach(() => safeCommandQueueRepository._reset());

  it('createCommand inicia PENDING dry-run con preview/risk/warnings', () => {
    const cmd = create();
    expect(cmd.status).toBe('PENDING');
    expect(cmd.dryRun).toBe(true);
    expect(cmd.wouldExecute).toBe(false);
    expect(cmd.riskLevel).toBe('medium');
    expect(cmd.simulatedCommands.length).toBeGreaterThan(0);
    expect(cmd.safetyWarnings.length).toBeGreaterThan(0);
  });

  it('REBOOT_CPE y SUSPEND_CUSTOMER son riesgo alto', () => {
    expect(create({ commandType: 'REBOOT_CPE' }).riskLevel).toBe('high');
    expect(create({ commandType: 'SUSPEND_CUSTOMER' }).riskLevel).toBe('high');
  });

  it('valida commandType y campos requeridos', () => {
    expect(() => safeCommandQueueService.createCommand({ commandType: 'NOPE' }, ACTOR)).toThrow();
    expect(() =>
      safeCommandQueueService.createCommand({ commandType: 'UPDATE_QUEUE', targetId: 't' }, ACTOR),
    ).toThrow(); // falta description
  });

  it('sanea payload sensible y campos libres', () => {
    const cmd = create({ payload: { token: 'abc' }, description: 'password=PROD1_SENTINEL_X' });
    expect((cmd.payload as Record<string, unknown>).token).toBe('[REDACTED]');
    expect(cmd.description).toBe('[REDACTED]');
  });

  it('flujo validate → simulate → approve', () => {
    const cmd = create();
    expect(safeCommandQueueService.validateCommand(cmd.id, ACTOR).status).toBe('VALIDATED');
    expect(safeCommandQueueService.simulateCommand(cmd.id, ACTOR).status).toBe('SIMULATED');
    const approved = safeCommandQueueService.approveCommand(cmd.id, 'boss');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('boss');
  });

  it('approve exige simulación previa (ConflictError)', () => {
    const cmd = create();
    expect(() => safeCommandQueueService.approveCommand(cmd.id, ACTOR)).toThrow();
    safeCommandQueueService.validateCommand(cmd.id, ACTOR);
    expect(() => safeCommandQueueService.approveCommand(cmd.id, ACTOR)).toThrow();
  });

  it('reject guarda razón saneada; cancel desde varios estados', () => {
    const r = create();
    const rejected = safeCommandQueueService.rejectCommand(r.id, ACTOR, 'token=PROD1_SENTINEL_R');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.notes).toBe('[REDACTED]');

    const c = create();
    safeCommandQueueService.validateCommand(c.id, ACTOR);
    expect(safeCommandQueueService.cancelCommand(c.id, ACTOR).status).toBe('CANCELLED');
  });

  it('estados terminales no transicionan', () => {
    const cmd = create();
    safeCommandQueueService.rejectCommand(cmd.id, ACTOR);
    expect(() => safeCommandQueueService.validateCommand(cmd.id, ACTOR)).toThrow();
    expect(() => safeCommandQueueService.cancelCommand(cmd.id, ACTOR)).toThrow();
  });

  it('nunca alcanza EXECUTED/RUNNING/COMPLETED', () => {
    const cmd = create();
    safeCommandQueueService.validateCommand(cmd.id, ACTOR);
    safeCommandQueueService.simulateCommand(cmd.id, ACTOR);
    safeCommandQueueService.approveCommand(cmd.id, ACTOR);
    const detail = safeCommandQueueService.getCommand(cmd.id);
    expect(['PENDING', 'VALIDATED', 'SIMULATED', 'APPROVED', 'REJECTED', 'CANCELLED']).toContain(
      detail.command.status,
    );
    expect(detail.command.wouldExecute).toBe(false);
  });

  it('getCommand inexistente lanza NotFound', () => {
    expect(() => safeCommandQueueService.getCommand('nope')).toThrow();
  });
});

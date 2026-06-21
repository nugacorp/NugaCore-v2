import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manualSafeModeService } from '../../backend/domains/manual-safe-mode/service';
import { manualSafeModeRepository } from '../../backend/domains/manual-safe-mode/repository';

// ====================================================================
// PROD-1 Manual Safe Mode — lógica del service (sin HTTP, sin ejecución).
// ====================================================================

const ACTOR = 'tester';

const create = () =>
  manualSafeModeService.createAction(
    {
      actionType: 'mikrotik.read',
      targetType: 'router',
      targetId: 'mkt-1',
      description: 'lectura mock',
      payload: { cmd: '/system/resource/print' },
      executionMode: 'DRY_RUN',
    },
    ACTOR,
  );

describe('manualSafeModeService', () => {
  beforeEach(() => manualSafeModeRepository._reset());
  afterEach(() => manualSafeModeRepository._reset());

  it('createAction inicia en PENDING, dryRun true por defecto y sin executedAt', () => {
    const action = manualSafeModeService.createAction(
      { actionType: 'a', targetType: 't', targetId: 'id', description: 'd' },
      ACTOR,
    );
    expect(action.status).toBe('PENDING');
    expect(action.dryRun).toBe(true);
    expect(action.executionMode).toBe('MANUAL');
    expect(action.createdBy).toBe(ACTOR);
    expect(action.executedAt).toBeUndefined();
  });

  it('createAction valida campos requeridos', () => {
    expect(() => manualSafeModeService.createAction({ actionType: '' }, ACTOR)).toThrow();
    expect(() =>
      manualSafeModeService.createAction({ actionType: 'a', targetType: 't', targetId: 'id' }, ACTOR),
    ).toThrow(); // falta description
  });

  it('createAction rechaza executionMode inválido y payload no-objeto', () => {
    expect(() =>
      manualSafeModeService.createAction(
        { actionType: 'a', targetType: 't', targetId: 'id', description: 'd', executionMode: 'EXECUTE' },
        ACTOR,
      ),
    ).toThrow();
    expect(() =>
      manualSafeModeService.createAction(
        { actionType: 'a', targetType: 't', targetId: 'id', description: 'd', payload: 'nope' },
        ACTOR,
      ),
    ).toThrow();
  });

  it('listActions y getAction devuelven datos + auditoría', () => {
    const created = create();
    expect(manualSafeModeService.listActions()).toHaveLength(1);
    const detail = manualSafeModeService.getAction(created.id);
    expect(detail.action.id).toBe(created.id);
    expect(detail.audit.map((a) => a.event)).toContain('CREATED');
  });

  it('getAction inexistente lanza NotFound', () => {
    expect(() => manualSafeModeService.getAction('nope')).toThrow();
  });

  it('approveAction setea approvedBy/approvedAt y audita', () => {
    const created = create();
    const approved = manualSafeModeService.approveAction(created.id, 'boss');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('boss');
    expect(approved.approvedAt).toBeTruthy();
    expect(manualSafeModeService.getAction(created.id).audit.some((a) => a.event === 'APPROVED')).toBe(true);
  });

  it('rejectAction guarda razón en notes', () => {
    const created = create();
    const rejected = manualSafeModeService.rejectAction(created.id, ACTOR, 'sin permiso');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.notes).toBe('sin permiso');
  });

  it('simulateAction solo cambia a SIMULATED y NO ejecuta (sin executedAt)', () => {
    const created = create();
    const simulated = manualSafeModeService.simulateAction(created.id, ACTOR);
    expect(simulated.status).toBe('SIMULATED');
    expect(simulated.executedAt).toBeUndefined();
    const entry = manualSafeModeService.getAction(created.id).audit.find((a) => a.event === 'SIMULATED');
    expect(entry?.details.toLowerCase()).toContain('no se ejecut');
  });

  it('cancelAction permite cancelar PENDING y APPROVED', () => {
    const a1 = create();
    expect(manualSafeModeService.cancelAction(a1.id, ACTOR).status).toBe('CANCELLED');

    const a2 = create();
    manualSafeModeService.approveAction(a2.id, ACTOR);
    expect(manualSafeModeService.cancelAction(a2.id, ACTOR).status).toBe('CANCELLED');
  });

  it('transiciones inválidas lanzan ConflictError (estado terminal)', () => {
    const created = create();
    manualSafeModeService.rejectAction(created.id, ACTOR);
    expect(() => manualSafeModeService.approveAction(created.id, ACTOR)).toThrow();
    expect(() => manualSafeModeService.simulateAction(created.id, ACTOR)).toThrow();
    expect(() => manualSafeModeService.cancelAction(created.id, ACTOR)).toThrow();
  });

  it('no existe forma de llegar al estado EXECUTED', () => {
    const created = create();
    manualSafeModeService.approveAction(created.id, ACTOR);
    const detail = manualSafeModeService.getAction(created.id);
    expect(detail.action.status).not.toBe('EXECUTED');
    expect(['PENDING', 'APPROVED', 'REJECTED', 'SIMULATED', 'CANCELLED']).toContain(detail.action.status);
  });
});

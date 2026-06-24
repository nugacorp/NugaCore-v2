import { describe, it, expect, beforeEach } from 'vitest';
import {
  requestSuspension,
  requestReactivation,
  listServiceStatusAudit,
} from '../../backend/domains/service-status/service';
import { serviceStatusStore } from '../../backend/domains/service-status/store';

// ====================================================================
// Unit — Service Status audit trail. Cada solicitud deja un evento con todos
// los campos requeridos y dryRun=true. No hay estados EXECUTED/RUNNING.
// ====================================================================

beforeEach(() => serviceStatusStore.reset());

describe('audit trail de service-status', () => {
  it('registra el evento con todos los campos requeridos y dryRun=true', async () => {
    const { event } = await requestSuspension('c-1', 'morosidad', 'cobranza');
    expect(event).toMatchObject({
      customerId: 'c-1',
      previousStatus: 'ACTIVE',
      nextStatus: 'SUSPENSION_PENDING',
      reason: 'morosidad',
      actorRole: 'cobranza',
      dryRun: true,
    });
    expect(typeof event.id).toBe('string');
    expect(typeof event.createdAt).toBe('string');
  });

  it('acumula eventos y permite filtrar por customerId', async () => {
    await requestSuspension('c-1', 'a', 'administrador');
    await requestReactivation('c-4', 'b', 'administrador');

    expect(listServiceStatusAudit().length).toBe(2);
    const onlyC1 = listServiceStatusAudit('c-1');
    expect(onlyC1.length).toBe(1);
    expect(onlyC1[0].customerId).toBe('c-1');
  });

  it('nunca emite estados ejecutados (EXECUTED/RUNNING)', async () => {
    await requestSuspension('c-1', '', 'cobranza');
    for (const e of listServiceStatusAudit()) {
      expect(['EXECUTED', 'RUNNING']).not.toContain(e.nextStatus);
      expect(e.dryRun).toBe(true);
    }
  });
});

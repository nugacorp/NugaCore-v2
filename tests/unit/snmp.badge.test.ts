import { describe, expect, it } from 'vitest';
import { snmpBadge, type SnmpTelemetryRouterView } from '../../src/lib/snmpTelemetry';

const view = (over: Partial<SnmpTelemetryRouterView>): SnmpTelemetryRouterView => ({
  routerId: 'mkt-1',
  name: 'router',
  source: 'pending',
  isReachable: false,
  fresh: false,
  ...over,
});

describe('snmpBadge (helper compartido de presentación)', () => {
  it('undefined → "sin SNMP" (fila de inventario sin telemetría)', () => {
    expect(snmpBadge(undefined).label).toBe('sin SNMP');
  });

  it('snmp-live + fresh → "En vivo"', () => {
    expect(snmpBadge(view({ source: 'snmp-live', isReachable: true, fresh: true })).label).toBe('En vivo');
  });

  it('snmp-live pero no fresh → "Desactualizada"', () => {
    expect(snmpBadge(view({ source: 'snmp-live', isReachable: true, fresh: false })).label).toBe('Desactualizada');
  });

  it('pending → "Sin muestra"', () => {
    expect(snmpBadge(view({ source: 'pending' })).label).toBe('Sin muestra');
  });

  it('disabled → "Poller off"', () => {
    expect(snmpBadge(view({ source: 'disabled' })).label).toBe('Poller off');
  });

  it('simulated/unreachable → "Sin respuesta"', () => {
    expect(snmpBadge(view({ source: 'simulated' })).label).toBe('Sin respuesta');
  });
});

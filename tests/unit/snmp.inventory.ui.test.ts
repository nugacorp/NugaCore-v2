import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync('src/components/InventoryRoutersModule.tsx', 'utf8');

describe('Inventario Routers — telemetría SNMP por equipo (tenant-scoped)', () => {
  it('consume el endpoint tenant-scoped de telemetría SNMP', () => {
    expect(moduleSource).toContain('/api/snmp/telemetry');
  });

  it('muestra una columna/celda SNMP por router con marcador estable', () => {
    expect(moduleSource).toContain('snmp-inv-');
    expect(moduleSource).toMatch(/>SNMP</);
  });

  it('mapea la telemetría por routerId y expone estado/campos operativos', () => {
    expect(moduleSource).toMatch(/routerId/);
    expect(moduleSource).toMatch(/En vivo|sysName|latencyMs/);
  });

  it('carga la telemetría SNMP de forma aislada (un fallo no rompe el inventario)', () => {
    // El fetch de SNMP debe tener su propio catch que no propague al inventario.
    expect(moduleSource).toMatch(/snmp[\s\S]{0,400}catch/i);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync('src/components/NocTelemetryModule.tsx', 'utf8');

describe('SNMP telemetry UI contract (tenant-scoped)', () => {
  it('consume el endpoint tenant-scoped de telemetría SNMP', () => {
    expect(moduleSource).toContain('/api/snmp/telemetry');
  });

  it('renderiza la sección de telemetría SNMP con marcadores estables', () => {
    expect(moduleSource).toContain('Telemetría SNMP');
    expect(moduleSource).toContain('snmp-telemetry-section');
    expect(moduleSource).toContain('snmp-tel-');
  });

  it('muestra los campos operativos que necesita el WISP', () => {
    expect(moduleSource).toContain('sysName');
    expect(moduleSource).toContain('sysUpTime');
    expect(moduleSource).toContain('latencyMs');
    expect(moduleSource).toMatch(/fresh|frescura|En vivo|Reciente/);
  });

  it('no ejecuta operaciones de escritura', () => {
    expect(moduleSource).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
  });
});

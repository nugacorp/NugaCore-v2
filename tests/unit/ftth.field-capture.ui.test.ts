import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Captura FTTH en la app del técnico', () => {
  const pwa = readFileSync('src/modules/tech-pwa/TechPwaModule.tsx', 'utf8');
  const optical = readFileSync('src/lib/ftthOptical.ts', 'utf8');
  const checklist = readFileSync('backend/domains/tickets/ftth-checklist.ts', 'utf8');

  it('los umbrales ópticos son una sola fuente compartida con el backend', () => {
    expect(optical).toContain('FTTH_RX_POWER_MIN_DBM = -27');
    expect(optical).toContain('FTTH_RX_POWER_WARN_DBM = -25');
    // El backend importa los umbrales, no los redefine.
    expect(checklist).toContain("from '../../../src/lib/ftthOptical'");
    expect(checklist).not.toMatch(/FTTH_RX_POWER_MIN_DBM\s*=\s*-27/);
  });

  it('muestra los campos obligatorios solo en órdenes de fibra', () => {
    expect(pwa).toContain("o.technology === 'fiber'");
    expect(pwa).toContain('Serie de ONU');
    expect(pwa).toContain('Caja NAP');
    expect(pwa).toContain('Potencia Rx (dBm)');
  });

  it('clasifica la lectura mientras se captura', () => {
    expect(pwa).toContain('classifyRxPower');
    expect(pwa).toContain('RX_POWER_LABELS');
  });

  it('envía la captura al cerrar y no encola rechazos 4xx en la cola offline', () => {
    expect(pwa).toContain('completeOrder');
    expect(pwa).toContain('draftToPayload');
    // Un 422 por checklist incompleto no debe reintentarse offline.
    expect(pwa).toMatch(/res\.status >= 400 && res\.status < 500/);
    expect(pwa).toContain('details?.errors');
  });

  it('muestra los motivos del bloqueo al técnico', () => {
    expect(pwa).toContain('blockers');
  });
});

describe('UI de fundación del worker OLT', () => {
  const olt = readFileSync('src/components/OltModule.tsx', 'utf8');

  it('gestiona credenciales sin exponer el password', () => {
    expect(olt).toContain('/credentials');
    expect(olt).toContain('type="password"');
    expect(olt).toContain('cifrada');
    // El componente nunca renderiza un password recibido del servidor.
    expect(olt).not.toMatch(/credMeta\??\.(password|encryptedPassword)/);
  });

  it('muestra la cola de acciones y su estado dry-run', () => {
    expect(olt).toContain('/api/olt-actions');
    expect(olt).toContain('executionEnabled');
    expect(olt).toContain('plannedCommands');
    expect(olt).toContain('dry-run');
  });
});

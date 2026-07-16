import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('FtthInfrastructurePanel — planta óptica', () => {
  const panel = readFileSync('src/components/gis/FtthInfrastructurePanel.tsx', 'utf8');
  const gis = readFileSync('src/components/GisModule.tsx', 'utf8');

  it('permite registrar tramos con hilos y PON/NAP', () => {
    expect(panel).toContain('ftth-add-fiber-route');
    expect(panel).toContain('threadCount');
    expect(panel).toContain('Capacidad por Puerto PON');
    expect(panel).toContain('nugacore.ftth.fiberRoutes.v1');
  });

  it('GisModule monta el panel de infraestructura', () => {
    expect(gis).toContain('FtthInfrastructurePanel');
  });
});

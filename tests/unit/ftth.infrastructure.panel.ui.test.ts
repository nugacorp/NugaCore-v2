import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('FtthInfrastructurePanel — planta óptica', () => {
  const panel = readFileSync('src/components/gis/FtthInfrastructurePanel.tsx', 'utf8');
  const gis = readFileSync('src/components/GisModule.tsx', 'utf8');

  it('registra tramos vía API (sin localStorage)', () => {
    expect(panel).toContain('ftth-add-fiber-route');
    expect(panel).toContain('threadCount');
    expect(panel).toContain('Capacidad por Puerto PON');
    expect(panel).toContain('/api/ftth/segments');
    expect(panel).not.toContain('nugacore.ftth.fiberRoutes.v1');
  });

  it('GisModule monta importador e infraestructura', () => {
    expect(gis).toContain('FtthInfrastructurePanel');
    expect(gis).toContain('FtthImportPanel');
    expect(gis).toContain('/api/ftth/segments');
  });
});

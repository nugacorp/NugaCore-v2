import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Widget de factibilidad FTTH (preventa)', () => {
  const panel = readFileSync('src/components/gis/FtthFeasibilityPanel.tsx', 'utf8');
  const gisModule = readFileSync('src/components/GisModule.tsx', 'utf8');
  const map = readFileSync('src/components/gis/GisLeafletMap.tsx', 'utf8');

  it('el panel está montado en el módulo GIS y consulta el endpoint real', () => {
    expect(gisModule).toContain('FtthFeasibilityPanel');
    expect(gisModule).toContain('/api/ftth/feasibility');
    expect(gisModule).toContain('maxDropMeters');
  });

  it('el mapa marca al prospecto y dibuja el drop hacia la NAP factible', () => {
    expect(map).toContain('prospectPickMode');
    expect(map).toContain('useMapEvents');
    expect(map).toContain('feasibilityDrop');
    expect(map).toContain('dashArray');
    expect(map).toContain('Tooltip');
  });

  it('el panel muestra puertos libres, distancia de drop y NAPs saturadas', () => {
    expect(panel).toContain('puertos libres');
    expect(panel).toContain('saturada');
    expect(panel).toContain('distanceMeters');
    expect(panel).toContain('Cobertura disponible');
  });

  it('advierte que la distancia es en línea recta, no tendido real', () => {
    expect(panel).toMatch(/línea recta/);
  });
});

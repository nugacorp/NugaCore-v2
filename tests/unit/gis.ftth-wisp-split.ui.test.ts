import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Separación FTTH mapa vs WISP sitios', () => {
  const gis = readFileSync('src/components/GisModule.tsx', 'utf8');
  const ftthMap = readFileSync('src/components/gis/GisLeafletMap.tsx', 'utf8');
  const network = readFileSync('src/components/NetworkModule.tsx', 'utf8');
  const wispMap = readFileSync('src/components/gis/WispSitesMap.tsx', 'utf8');
  const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');

  it('Mapa FTTH es planta óptica (sin capas WISP)', () => {
    expect(gis).toContain('Mapa FTTH · Planta de Fibra');
    expect(gis).toContain('Capas ópticas');
    expect(gis).not.toContain('Ver Radioenlaces');
    expect(gis).not.toContain('showPlannedTower');
    expect(ftthMap).toContain('Planta FTTH');
    expect(ftthMap).not.toContain('towerIcon');
  });

  it('Torres y Sitios usa mapa WISP estilo UISP', () => {
    expect(network).toContain('WispSitesMap');
    expect(network).toContain('Mapa de sitios');
    expect(network).not.toContain('Topología de Enlaces Backhaul');
    expect(wispMap).toContain('Sitios WISP');
    expect(wispMap).toContain('Backhaul');
  });

  it('Sidebar etiqueta GIS como Mapa FTTH', () => {
    expect(sidebar).toContain("name: 'Mapa FTTH'");
  });

  it('contador OLT muestra valor real (sin mínimo artificial)', () => {
    expect(gis).toContain('{olts.length}');
    expect(gis).not.toContain('Math.max(olts.length, 1)');
  });
});

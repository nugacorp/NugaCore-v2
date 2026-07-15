import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GIS Co-Map Leaflet', () => {
  const moduleSource = readFileSync('src/components/GisModule.tsx', 'utf8');
  const mapSource = readFileSync('src/components/gis/GisLeafletMap.tsx', 'utf8');
  const csp = readFileSync('backend/common/http-security.ts', 'utf8');

  it('usa Leaflet en el visualizador central', () => {
    expect(moduleSource).toContain('GisLeafletMap');
    expect(mapSource).toContain('MapContainer');
    expect(mapSource).toContain('basemaps.cartocdn.com');
    expect(mapSource).toContain('scrollWheelZoom');
  });

  it('CSP permite tiles de mapa', () => {
    expect(csp).toContain('basemaps.cartocdn.com');
    expect(csp).toContain('tile.openstreetmap.org');
  });
});

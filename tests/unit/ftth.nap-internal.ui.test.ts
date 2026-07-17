import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('FtthImportPanel — importador', () => {
  const panel = readFileSync('src/components/gis/FtthImportPanel.tsx', 'utf8');

  it('expone preview e import contra API', () => {
    expect(panel).toContain('ftth-import-panel');
    expect(panel).toContain('ftth-import-preview');
    expect(panel).toContain('ftth-import-run');
    expect(panel).toContain('/api/ftth/import');
  });

  it('permite al WISP descargar CSV/GeoJSON reales desde la UI', () => {
    expect(panel).toContain('ftth-export-actions');
    expect(panel).toContain('ftth-export-naps-csv');
    expect(panel).toContain('ftth-export-segments-csv');
    expect(panel).toContain('ftth-export-geojson');
    expect(panel).toContain('Mis NAPs (CSV)');
    expect(panel).toContain('No necesitas acceso al servidor');
  });
});

describe('NapInternalView — vista interna NAP', () => {
  const view = readFileSync('src/components/gis/NapInternalView.tsx', 'utf8');
  const map = readFileSync('src/components/gis/GisLeafletMap.tsx', 'utf8');

  it('muestra grilla de puertos y continuidad', () => {
    expect(view).toContain('nap-internal-view');
    expect(view).toContain('nap-port-');
    expect(view).toContain('continuesToNapId');
    expect(view).toContain('Puertos / hilos');
  });

  it('GisLeafletMap monta NapInternalView al click NAP', () => {
    expect(map).toContain('NapInternalView');
    expect(map).toContain("type: 'nap'");
  });
});

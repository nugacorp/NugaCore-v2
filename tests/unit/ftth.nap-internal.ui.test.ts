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

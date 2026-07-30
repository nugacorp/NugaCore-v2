import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// Cabeceras de auth en el módulo GIS.
//
// El fallo original: GisModule pedía /api/naps y /api/ftth/segments con
// `fetch(url)` pelado, sin Bearer, y staging respondía 401 en un runtime
// endurecido (donde los trusted-headers se ignoran y la identidad solo viene
// del JWT).
//
// Comprobar que la cadena `getAuthHeaders` aparece en cada archivo NO basta:
// los paneles hijos la declaraban y usaban mientras GisModule no se la pasaba,
// así que seguían saliendo sin cabecera. Estos tests verifican el CABLEADO
// completo — App → GisModule → paneles — no la mera presencia del símbolo.
// ====================================================================

const app = readFileSync('src/App.tsx', 'utf8');
const gis = readFileSync('src/components/GisModule.tsx', 'utf8');
const infrastructurePanel = readFileSync('src/components/gis/FtthInfrastructurePanel.tsx', 'utf8');
const importPanel = readFileSync('src/components/gis/FtthImportPanel.tsx', 'utf8');

/** Extrae el bloque JSX de `<Componente ... />` para inspeccionar sus props. */
const jsxProps = (source: string, component: string): string => {
  const start = source.indexOf(`<${component}`);
  if (start === -1) return '';
  const end = source.indexOf('/>', start);
  return end === -1 ? '' : source.slice(start, end);
};

describe('GIS — cableado de getAuthHeaders', () => {
  it('App se lo pasa a GisModule', () => {
    expect(jsxProps(app, 'GisModule')).toContain('getAuthHeaders={getAuthHeaders}');
  });

  it('GisModule se lo pasa a FtthImportPanel', () => {
    expect(jsxProps(gis, 'FtthImportPanel')).toContain('getAuthHeaders={getAuthHeaders}');
  });

  it('GisModule se lo pasa a FtthInfrastructurePanel', () => {
    expect(jsxProps(gis, 'FtthInfrastructurePanel')).toContain('getAuthHeaders={getAuthHeaders}');
  });
});

describe('GIS — lecturas protegidas', () => {
  it('GisModule resuelve las cabeceras y las usa en las lecturas FTTH', () => {
    expect(gis).toContain('getAuthHeaders?.()');
    expect(gis).toContain("fetchList<NapBox[]>('/api/naps', authHeaders)");
    expect(gis).toContain("fetchList<FiberSegment[]>('/api/ftth/segments', authHeaders)");
  });

  it('fetchList no puede pedir sin cabeceras por accidente', () => {
    // La firma acepta un default `{}`, pero ninguna llamada debe omitir el
    // segundo argumento: `fetchList<T>('/api/...')` a secas es el bug original.
    const bareCalls = gis.match(/fetchList<[^>]+>\('\/api\/[^']+'\)/g);
    expect(bareCalls, `llamadas sin cabeceras: ${bareCalls?.join(', ')}`).toBeNull();
  });
});

describe('GIS — escrituras protegidas', () => {
  it('la edición de puertos NAP manda cabeceras', () => {
    expect(gis).toContain('headers: { ...authHeaders');
  });

  it('los paneles mandan cabeceras en sus mutaciones', () => {
    expect(infrastructurePanel).toContain('getAuthHeaders');
    expect(infrastructurePanel).toContain('headers: { ...authHeaders');
    expect(importPanel).toContain('getAuthHeaders');
    expect(importPanel).toContain('headers: { ...authHeaders');
  });

  it('ningún fetch a /api en el módulo GIS declara solo Content-Type', () => {
    for (const [name, source] of [
      ['GisModule', gis],
      ['FtthInfrastructurePanel', infrastructurePanel],
      ['FtthImportPanel', importPanel],
    ] as const) {
      const naked = source.match(/headers: \{ 'Content-Type'/g);
      expect(naked, `${name} tiene ${naked?.length} fetch sin auth`).toBeNull();
    }
  });
});

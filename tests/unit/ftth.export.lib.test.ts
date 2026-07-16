import { describe, expect, it } from 'vitest';
import { napsToCsv, segmentsToCsv, toFtthGeoJson } from '../../src/lib/ftthExport';
import type { FiberSegment, NapBox } from '../../src/types';

const sampleNap: NapBox = {
  id: 'NAP-01',
  name: 'Caja Centro',
  ponPort: '1/1',
  fibersFree: 6,
  fibersTotal: 8,
  lat: 19.4285,
  lng: -99.1655,
  splitRatio: '1:8',
  coverageMeters: 250,
  ports: [],
};

const sampleSegment: FiberSegment = {
  id: 'SEG-01',
  name: 'Feeder Centro',
  fromRef: 'OLT-1',
  toRef: 'NAP-01',
  fromLabel: 'OLT-1',
  toLabel: 'NAP-01',
  segmentType: 'feeder',
  threadCount: 12,
  coordinates: [
    [19.43, -99.17],
    [19.428, -99.165],
  ],
};

describe('ftthExport — CSV/GeoJSON para WISP', () => {
  it('genera CSV de NAPs con encabezados del importador', () => {
    const csv = napsToCsv([sampleNap]);
    expect(csv).toContain('id,name,lat,lng,pon_port,split_ratio,fibers_total,coverage_m');
    expect(csv).toContain('NAP-01,Caja Centro,19.4285,-99.1655,1/1,1:8,8,250');
  });

  it('genera CSV de tramos con coordenadas JSON', () => {
    const csv = segmentsToCsv([sampleSegment]);
    expect(csv).toContain('id,name,from_id,to_id,type,thread_count,coordinates');
    expect(csv).toContain('SEG-01');
    expect(csv).toContain('[[19.43,-99.17]');
  });

  it('arma FeatureCollection Point + LineString', () => {
    const geo = toFtthGeoJson([sampleNap], [sampleSegment]);
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features).toHaveLength(2);
    expect(geo.features[0].geometry.type).toBe('Point');
    expect(geo.features[1].geometry.type).toBe('LineString');
    // GeoJSON usa [lng, lat]
    expect(geo.features[0].geometry.coordinates).toEqual([-99.1655, 19.4285]);
  });
});

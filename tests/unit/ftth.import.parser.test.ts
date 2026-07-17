import { describe, expect, it } from 'vitest';
import {
  parseGeoJsonImport,
  parseNapCsv,
  parseSegmentCsv,
  previewFtthImport,
} from '../../backend/domains/network/ftth-import-parser';

describe('ftth-import-parser', () => {
  it('parsea CSV de NAPs', () => {
    const csv = `id,name,lat,lng,pon_port,split_ratio,fibers_total,coverage_m
NAP-99,Prueba,19.43,-99.16,1/2,1:8,8,300`;
    const { naps, errors } = parseNapCsv(csv);
    expect(errors).toHaveLength(0);
    expect(naps).toHaveLength(1);
    expect(naps[0].id).toBe('NAP-99');
    expect(naps[0].ports).toHaveLength(8);
  });

  it('rechaza filas NAP sin coordenadas', () => {
    const { naps, errors } = parseNapCsv('id,name,lat,lng\nX,Sin coords,,');
    expect(naps).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('parsea CSV de tramos con coordenadas JSON', () => {
    const csv = `id,name,from_id,to_id,type,thread_count,coordinates
SEG-1,Feeder,OLT,NAP-01,feeder,12,"[[19.43,-99.17],[19.428,-99.165]]"`;
    const { segments, errors } = parseSegmentCsv(csv);
    expect(errors).toHaveLength(0);
    expect(segments[0].coordinates).toHaveLength(2);
    expect(segments[0].threadCount).toBe(12);
  });

  it('parsea GeoJSON mixto Point + LineString', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-99.16, 19.43] },
          properties: { id: 'NAP-GJ', name: 'Geo NAP', fibers_total: 4 },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-99.17, 19.43],
              [-99.16, 19.428],
            ],
          },
          properties: { id: 'SEG-GJ', name: 'Tramo Geo', thread_count: 6 },
        },
      ],
    });
    const result = parseGeoJsonImport(geojson);
    expect(result.naps).toHaveLength(1);
    expect(result.segments).toHaveLength(1);
    expect(result.naps[0].lat).toBeCloseTo(19.43);
  });

  it('preview mixed combina ambos CSV', () => {
    const preview = previewFtthImport({
      format: 'mixed',
      napsCsv: 'id,name,lat,lng\nNAP-A,A,1,2',
      segmentsCsv: 'id,name,from_id,to_id,type,thread_count,coordinates\nS1,T,OLT,NAP-A,feeder,8,',
    });
    expect(preview.naps).toHaveLength(1);
    expect(preview.segments).toHaveLength(1);
  });
});

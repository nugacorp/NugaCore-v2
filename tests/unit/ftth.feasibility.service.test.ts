import { describe, expect, it } from 'vitest';
import {
  boundingBoxFor,
  isInBoundingBox,
  rankNapCandidates,
  FtthFeasibilityService,
  MAX_SEARCH_RADIUS_METERS,
  METERS_PER_DEGREE_LAT,
  type NapSource,
} from '../../backend/domains/coverage/ftth-feasibility';
import type { BoundingBox, NapCandidate } from '../../backend/domains/coverage/types';

const PROSPECT = { lat: 19.4285, lng: -99.1655 };

const nap = (over: Partial<NapCandidate> & { id: string }): NapCandidate => ({
  name: `NAP ${over.id}`,
  lat: PROSPECT.lat,
  lng: PROSPECT.lng,
  freePorts: 4,
  totalPorts: 8,
  splitRatio: '1:8',
  ponPort: 'PON-01',
  coverageMeters: 250,
  ...over,
});

const sourceOf = (naps: NapCandidate[]): NapSource => ({
  listInBoundingBox: async (box: BoundingBox) =>
    naps.filter((n) => isInBoundingBox(n.lat, n.lng, box)),
});

describe('Bounding box de factibilidad FTTH', () => {
  it('escala el delta de longitud por 1/cos(lat)', () => {
    const box = boundingBoxFor(PROSPECT.lat, PROSPECT.lng, 250);
    const latDelta = box.maxLat - PROSPECT.lat;
    const lngDelta = box.maxLng - PROSPECT.lng;
    expect(latDelta).toBeCloseTo(250 / METERS_PER_DEGREE_LAT, 6);
    // A 19.4° de latitud un grado de longitud es ~5.7% más corto que uno de latitud.
    expect(lngDelta).toBeGreaterThan(latDelta);
    expect(lngDelta).toBeCloseTo(latDelta / Math.cos((PROSPECT.lat * Math.PI) / 180), 6);
  });

  it('incluye una NAP desplazada solo en longitud dentro del radio', () => {
    const box = boundingBoxFor(PROSPECT.lat, PROSPECT.lng, 250);
    // ~200 m al este: cae fuera si el bbox no corrige la longitud.
    const eastLng = PROSPECT.lng + 200 / (METERS_PER_DEGREE_LAT * Math.cos((PROSPECT.lat * Math.PI) / 180));
    expect(isInBoundingBox(PROSPECT.lat, eastLng, box)).toBe(true);
  });

  it('abre la longitud completa cerca de los polos y al cruzar el antimeridiano', () => {
    expect(boundingBoxFor(90, 0, 250).minLng).toBe(-180);
    const antimeridian = boundingBoxFor(0, 179.9999, 250);
    expect(antimeridian.minLng).toBe(-180);
    expect(antimeridian.maxLng).toBe(180);
  });
});

describe('Ranking de NAPs candidatas', () => {
  it('convierte km a metros y descarta las que exceden el drop', () => {
    const lejana = nap({ id: 'lejos', lat: PROSPECT.lat + 0.01 }); // ~1.1 km
    const cerca = nap({ id: 'cerca', lat: PROSPECT.lat + 0.0009 }); // ~100 m
    const ranked = rankNapCandidates(PROSPECT.lat, PROSPECT.lng, [lejana, cerca], 250);
    expect(ranked.map((c) => c.napId)).toEqual(['cerca']);
    expect(ranked[0].distanceMeters).toBeGreaterThan(90);
    expect(ranked[0].distanceMeters).toBeLessThan(110);
  });

  it('ordena por distancia y marca cobertura y puertos', () => {
    const ranked = rankNapCandidates(
      PROSPECT.lat,
      PROSPECT.lng,
      [
        nap({ id: 'media', lat: PROSPECT.lat + 0.0018, coverageMeters: 100 }),
        nap({ id: 'pegada', lat: PROSPECT.lat + 0.0002, freePorts: 0 }),
      ],
      250,
    );
    expect(ranked.map((c) => c.napId)).toEqual(['pegada', 'media']);
    expect(ranked[0].hasFreePort).toBe(false);
    expect(ranked[1].withinCoverage).toBe(false);
  });

  it('ignora NAPs sin coordenadas válidas', () => {
    const ranked = rankNapCandidates(
      PROSPECT.lat,
      PROSPECT.lng,
      [nap({ id: 'sin-geo', lat: 0, lng: 0 })],
      250,
    );
    expect(ranked).toEqual([]);
  });
});

describe('FtthFeasibilityService', () => {
  it('elige la NAP más cercana CON puerto libre, no la más cercana a secas', async () => {
    const service = new FtthFeasibilityService(
      sourceOf([
        nap({ id: 'NAP-SAT', lat: PROSPECT.lat + 0.0003, freePorts: 0 }),
        nap({ id: 'NAP-OK', lat: PROSPECT.lat + 0.0012, freePorts: 2 }),
      ]),
    );

    const result = await service.check({ ...toInput(PROSPECT) });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ELIGIBLE');
    expect(result.best?.napId).toBe('NAP-OK');
    expect(result.best?.freePorts).toBe(2);
    // La saturada sigue visible como candidata para el mapa de demanda.
    expect(result.candidates.map((c) => c.napId)).toEqual(['NAP-SAT', 'NAP-OK']);
  });

  it('distingue "sin NAP en rango" de "NAPs saturadas"', async () => {
    const saturadas = new FtthFeasibilityService(
      sourceOf([nap({ id: 'NAP-SAT', freePorts: 0 })]),
    );
    await expect(saturadas.check(toInput(PROSPECT))).resolves.toMatchObject({
      eligible: false,
      reason: 'NO_FREE_PORT_IN_RANGE',
    });

    const vacio = new FtthFeasibilityService(sourceOf([]));
    await expect(vacio.check(toInput(PROSPECT))).resolves.toMatchObject({
      eligible: false,
      reason: 'NO_NAP_IN_RANGE',
      best: null,
      candidates: [],
    });
  });

  it('aplica el radio por defecto y lo topa en el máximo permitido', async () => {
    const service = new FtthFeasibilityService(sourceOf([]));
    await expect(service.check(toInput(PROSPECT))).resolves.toMatchObject({
      searchRadiusMeters: 250,
    });
    await expect(
      service.check({ ...toInput(PROSPECT), maxDropMeters: 99_999 }),
    ).resolves.toMatchObject({ searchRadiusMeters: MAX_SEARCH_RADIUS_METERS });
  });

  it('rechaza coordenadas fuera de rango', async () => {
    const service = new FtthFeasibilityService(sourceOf([]));
    await expect(
      service.check({ latitude: 91, longitude: 0, tenantId: 'tenant-default' }),
    ).rejects.toThrow('INVALID_COORDINATES');
  });

  it('propaga el tenant a la fuente de datos', async () => {
    const seen: string[] = [];
    const service = new FtthFeasibilityService({
      listInBoundingBox: async (_box, tenantId) => {
        seen.push(tenantId);
        return [];
      },
    });
    await service.check({ ...toInput(PROSPECT), tenantId: 'tenant-acme' });
    expect(seen).toEqual(['tenant-acme']);
  });
});

function toInput(point: { lat: number; lng: number }) {
  return { latitude: point.lat, longitude: point.lng, tenantId: 'tenant-default' };
}

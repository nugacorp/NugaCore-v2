import { describe, expect, it } from 'vitest';
import {
  calculateAzimuth,
  calculateDistanceKm,
  CoverageService,
} from '../../backend/domains/coverage/service';

const router = {
  id: 'tower-test',
  name: 'Torre Test',
  kind: 'tower' as const,
  description: 'Mock',
  latitude: 19.4,
  longitude: -99.17,
  coverageRadiusKm: 5,
  source: 'mock-local' as const,
};

const service = new CoverageService({
  getRouter: async (routerId: string) => routerId === router.id ? router : null,
});

describe('Coverage service', () => {
  it('calcula distancia y azimut geográficos', () => {
    expect(calculateDistanceKm(19.4, -99.17, 19.41, -99.17)).toBeGreaterThan(1);
    expect(calculateAzimuth(19.4, -99.17, 19.41, -99.17)).toBeCloseTo(0, 1);
  });

  it('clasifica GOOD, WARNING y POOR sin bloquear', async () => {
    await expect(service.check({
      routerId: router.id,
      latitude: 19.41,
      longitude: -99.17,
    })).resolves.toMatchObject({ status: 'GOOD' });

    await expect(service.check({
      routerId: router.id,
      latitude: 19.442,
      longitude: -99.17,
    })).resolves.toMatchObject({ status: 'WARNING' });

    await expect(service.check({
      routerId: router.id,
      latitude: 19.47,
      longitude: -99.17,
    })).resolves.toMatchObject({ status: 'POOR', estimatedCoverage: 0 });
  });

  it('rechaza coordenadas fuera de rango y devuelve null para router inexistente', async () => {
    await expect(service.check({
      routerId: router.id,
      latitude: 91,
      longitude: 0,
    })).rejects.toThrow('INVALID_COORDINATES');
    await expect(service.check({
      routerId: 'missing',
      latitude: 19.4,
      longitude: -99.17,
    })).resolves.toBeNull();
  });
});

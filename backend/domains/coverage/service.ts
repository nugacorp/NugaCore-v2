import { ipamService, type IpamService } from '../ipam/service';
import type { CoverageCheckInput, CoverageCheckResult } from './types';

const EARTH_RADIUS_KM = 6371;
const radians = (degrees: number) => degrees * (Math.PI / 180);
const degrees = (value: number) => value * (180 / Math.PI);
const rounded = (value: number, precision = 2) => Number(value.toFixed(precision));

export const isValidLatitude = (value: number): boolean =>
  Number.isFinite(value) && value >= -90 && value <= 90;

export const isValidLongitude = (value: number): boolean =>
  Number.isFinite(value) && value >= -180 && value <= 180;

export const calculateDistanceKm = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number => {
  const latitudeDelta = radians(toLat - fromLat);
  const longitudeDelta = radians(toLng - fromLng);
  const a = (
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(fromLat)) *
      Math.cos(radians(toLat)) *
      Math.sin(longitudeDelta / 2) ** 2
  );
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const calculateAzimuth = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number => {
  const longitudeDelta = radians(toLng - fromLng);
  const y = Math.sin(longitudeDelta) * Math.cos(radians(toLat));
  const x = (
    Math.cos(radians(fromLat)) * Math.sin(radians(toLat)) -
    Math.sin(radians(fromLat)) * Math.cos(radians(toLat)) * Math.cos(longitudeDelta)
  );
  return (degrees(Math.atan2(y, x)) + 360) % 360;
};

export class CoverageService {
  constructor(private readonly ipam: Pick<IpamService, 'getRouter'> = ipamService) {}

  async check(input: CoverageCheckInput): Promise<CoverageCheckResult | null> {
    if (!isValidLatitude(input.latitude) || !isValidLongitude(input.longitude)) {
      throw new Error('INVALID_COORDINATES');
    }

    const router = await this.ipam.getRouter(input.routerId);
    if (!router) return null;

    const distanceKm = calculateDistanceKm(
      router.latitude,
      router.longitude,
      input.latitude,
      input.longitude,
    );
    const radius = Math.max(0.1, router.coverageRadiusKm);
    const ratio = distanceKm / radius;
    const status = ratio <= 0.7 ? 'GOOD' : ratio <= 1 ? 'WARNING' : 'POOR';

    return {
      distanceKm: rounded(distanceKm),
      azimuth: rounded(calculateAzimuth(
        router.latitude,
        router.longitude,
        input.latitude,
        input.longitude,
      ), 1),
      estimatedCoverage: Math.max(0, rounded(100 - ratio * 100, 1)),
      status,
    };
  }
}

export const coverageService = new CoverageService();

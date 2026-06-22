export type CoverageStatus = 'GOOD' | 'WARNING' | 'POOR';

export interface CoverageCheckInput {
  routerId: string;
  latitude: number;
  longitude: number;
}

export interface CoverageCheckResult {
  distanceKm: number;
  azimuth: number;
  estimatedCoverage: number;
  status: CoverageStatus;
}

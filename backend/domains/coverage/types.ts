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

// ── Factibilidad FTTH (preventa) ──────────────────────────────────────

/** Caja NAP/CTO candidata, ya normalizada desde DB o store. */
export interface NapCandidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  freePorts: number;
  totalPorts: number;
  splitRatio: string;
  ponPort: string;
  coverageMeters: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// El contrato de respuesta vive en src/types.ts (compartido con el frontend).
export type {
  FtthFeasibilityCandidate,
  FtthFeasibilityReason,
  FtthFeasibilityResult,
} from '../../../src/types';

export interface FtthFeasibilityInput {
  latitude: number;
  longitude: number;
  maxDropMeters?: number;
  tenantId: string;
}

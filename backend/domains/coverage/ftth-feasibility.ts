// ====================================================================
// Factibilidad FTTH de preventa.
//
// Responde "¿puedo vender fibra en esta coordenada?": busca la NAP/CTO más
// cercana con puerto libre y devuelve la distancia de drop estimada.
//
// Sin PostGIS: bounding box sobre nap_boxes.lat/lng (columnas numéricas
// indexadas) + haversine en memoria sobre el conjunto ya acotado. Una sola
// consulta a Supabase — los puertos vienen embebidos, no en un query por NAP.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';
import { store } from '../../state/store';
import {
  getTenantColumnReady,
  isMissingTenantIdColumnError,
  setTenantColumnReady,
} from '../tenancy/tenant-scope';
import { calculateDistanceKm, isValidLatitude, isValidLongitude } from './service';
import type {
  BoundingBox,
  FtthFeasibilityCandidate,
  FtthFeasibilityInput,
  FtthFeasibilityResult,
  NapCandidate,
} from './types';

/** Límite estándar de cable drop en planta externa. */
export const DEFAULT_MAX_DROP_METERS = 250;
/** Tope duro: más allá el drop deja de ser viable y la consulta se vuelve cara. */
export const MAX_SEARCH_RADIUS_METERS = 2000;
/** Metros por grado de latitud (WGS-84, aproximación suficiente para bbox). */
export const METERS_PER_DEGREE_LAT = 111_320;

const NAP_TABLE = 'nap_boxes';
const MAX_ROWS = 500;

const radians = (degrees: number) => degrees * (Math.PI / 180);

const validPoint = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

/**
 * Caja de búsqueda alrededor del prospecto.
 *
 * El delta de longitud se escala por 1/cos(lat): un grado de longitud mide
 * ~111 km en el ecuador pero se encoge hacia los polos. Sin ese factor la caja
 * queda angosta y deja fuera NAPs que sí están en rango.
 */
export const boundingBoxFor = (
  lat: number,
  lng: number,
  radiusMeters: number,
): BoundingBox => {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const cosLat = Math.abs(Math.cos(radians(lat)));
  // Cerca de los polos cos(lat)→0: abrimos la longitud entera y deja filtrar a haversine.
  const lngDelta = cosLat < 1e-6 ? 360 : latDelta / cosLat;
  const minLng = lng - lngDelta;
  const maxLng = lng + lngDelta;
  const crossesAntimeridian = minLng < -180 || maxLng > 180;

  return {
    minLat: Math.max(-90, lat - latDelta),
    maxLat: Math.min(90, lat + latDelta),
    minLng: crossesAntimeridian ? -180 : minLng,
    maxLng: crossesAntimeridian ? 180 : maxLng,
  };
};

export const isInBoundingBox = (lat: number, lng: number, box: BoundingBox): boolean =>
  lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;

/**
 * Ordena las NAPs candidatas por distancia real al prospecto y descarta las
 * que quedan fuera del radio de drop. `calculateDistanceKm` devuelve km: aquí
 * se convierte a metros una sola vez.
 */
export const rankNapCandidates = (
  latitude: number,
  longitude: number,
  naps: NapCandidate[],
  maxDropMeters: number,
): FtthFeasibilityCandidate[] =>
  naps
    .filter((nap) => validPoint(nap.lat, nap.lng))
    .map((nap) => {
      const distanceMeters = calculateDistanceKm(latitude, longitude, nap.lat, nap.lng) * 1000;
      return {
        napId: nap.id,
        napName: nap.name,
        distanceMeters: Math.round(distanceMeters),
        freePorts: nap.freePorts,
        totalPorts: nap.totalPorts,
        splitRatio: nap.splitRatio,
        ponPort: nap.ponPort,
        lat: nap.lat,
        lng: nap.lng,
        hasFreePort: nap.freePorts > 0,
        withinCoverage: nap.coverageMeters > 0 && distanceMeters <= nap.coverageMeters,
      };
    })
    .filter((candidate) => candidate.distanceMeters <= maxDropMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

// ── Fuentes de NAPs ───────────────────────────────────────────────────

export interface NapSource {
  listInBoundingBox(box: BoundingBox, tenantId: string): Promise<NapCandidate[]>;
}

const countFreePorts = (
  ports: Array<{ status?: unknown }> | undefined,
  fibersFree: number,
  fibersTotal: number,
): { freePorts: number; totalPorts: number } => {
  if (ports && ports.length > 0) {
    return {
      freePorts: ports.filter((p) => String(p.status ?? 'free') === 'free').length,
      totalPorts: Math.max(ports.length, fibersTotal),
    };
  }
  // NAP sin filas de puertos: caemos a los contadores del cabezal.
  return { freePorts: fibersFree, totalPorts: fibersTotal };
};

/**
 * Store en memoria (modo demo/single-WISP). `NapBox` no lleva tenant, así que
 * el filtro por tenant solo aplica en la fuente Supabase.
 */
export class StoreNapSource implements NapSource {
  async listInBoundingBox(box: BoundingBox): Promise<NapCandidate[]> {
    return store.NAP_BOXES.filter((nap) => isInBoundingBox(nap.lat, nap.lng, box)).map((nap) => {
      const { freePorts, totalPorts } = countFreePorts(
        nap.ports,
        nap.fibersFree ?? 0,
        nap.fibersTotal ?? 0,
      );
      return {
        id: nap.id,
        name: nap.name,
        lat: nap.lat,
        lng: nap.lng,
        freePorts,
        totalPorts,
        splitRatio: nap.splitRatio ?? '',
        ponPort: nap.ponPort ?? '',
        coverageMeters: Number(nap.coverageMeters ?? 0),
      };
    });
  }
}

export class SupabaseNapSource implements NapSource {
  constructor(private readonly admin: SupabaseClient) {}

  private select(box: BoundingBox, tenantId: string | null) {
    // Hint FK explícito: nap_ports tiene nap_id y continues_to_nap_id → ambigüedad PostgREST.
    let query = this.admin
      .from(NAP_TABLE)
      .select(
        'id,name,lat,lng,pon_port,split_ratio,fibers_free,fibers_total,coverage_meters,nap_ports!nap_id(status)',
      )
      .gte('lat', box.minLat)
      .lte('lat', box.maxLat)
      .gte('lng', box.minLng)
      .lte('lng', box.maxLng)
      .limit(MAX_ROWS);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    return query;
  }

  async listInBoundingBox(box: BoundingBox, tenantId: string): Promise<NapCandidate[]> {
    const useTenantEq = getTenantColumnReady(NAP_TABLE) !== false && Boolean(tenantId);
    let { data, error } = await this.select(box, useTenantEq ? tenantId : null);

    if (error && useTenantEq && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(NAP_TABLE, false);
      logger.warn('nap_boxes.tenant_id ausente — factibilidad sin filtro de tenant (aplicar 20260717050000)');
      ({ data, error } = await this.select(box, null));
    } else if (!error && useTenantEq) {
      setTenantColumnReady(NAP_TABLE, true);
    }
    if (error) throw error;

    return (data ?? []).map((raw) => {
      const row = raw as Record<string, unknown>;
      const ports = Array.isArray(row.nap_ports)
        ? (row.nap_ports as Array<{ status?: unknown }>)
        : [];
      const fibersTotal = Number(row.fibers_total ?? 0);
      const { freePorts, totalPorts } = countFreePorts(
        ports,
        Number(row.fibers_free ?? 0),
        fibersTotal,
      );
      return {
        id: String(row.id),
        name: String(row.name ?? row.id),
        lat: Number(row.lat ?? 0),
        lng: Number(row.lng ?? 0),
        freePorts,
        totalPorts,
        splitRatio: String(row.split_ratio ?? ''),
        ponPort: String(row.pon_port ?? ''),
        coverageMeters: Number(row.coverage_meters ?? 0),
      };
    });
  }
}

// ── Servicio ──────────────────────────────────────────────────────────

const REASON_MESSAGES: Record<FtthFeasibilityResult['reason'], string> = {
  ELIGIBLE: 'Cobertura FTTH disponible.',
  NO_NAP_IN_RANGE: 'Sin cajas NAP dentro del radio de drop.',
  NO_FREE_PORT_IN_RANGE: 'Hay NAPs cerca pero todas están saturadas.',
};

export class FtthFeasibilityService {
  constructor(private readonly source: NapSource = resolveDefaultSource()) {}

  async check(input: FtthFeasibilityInput): Promise<FtthFeasibilityResult> {
    const { latitude, longitude } = input;
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
      throw new Error('INVALID_COORDINATES');
    }

    const requested = Number(input.maxDropMeters ?? DEFAULT_MAX_DROP_METERS);
    const searchRadiusMeters = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_SEARCH_RADIUS_METERS)
      : DEFAULT_MAX_DROP_METERS;

    const box = boundingBoxFor(latitude, longitude, searchRadiusMeters);
    const naps = await this.source.listInBoundingBox(box, input.tenantId);
    const candidates = rankNapCandidates(latitude, longitude, naps, searchRadiusMeters);
    const best = candidates.find((c) => c.hasFreePort) ?? null;

    const reason: FtthFeasibilityResult['reason'] = best
      ? 'ELIGIBLE'
      : candidates.length === 0
        ? 'NO_NAP_IN_RANGE'
        : 'NO_FREE_PORT_IN_RANGE';

    return {
      eligible: Boolean(best),
      reason,
      message: REASON_MESSAGES[reason],
      searchRadiusMeters,
      best,
      candidates,
    };
  }
}

const resolveDefaultSource = (): NapSource =>
  isDomainOnDb('ftth') && isSupabaseAdminConfigured && supabaseAdmin
    ? new SupabaseNapSource(supabaseAdmin)
    : new StoreNapSource();

let cached: FtthFeasibilityService | null = null;

export const getFtthFeasibilityService = (): FtthFeasibilityService => {
  if (!cached) cached = new FtthFeasibilityService();
  return cached;
};

export const resetFtthFeasibilityService = (): void => {
  cached = null;
};

// ====================================================================
// Mappers del dominio Plans — traducen entre la fila de Postgres
// (snake_case, tabla public.plans) y el "registro de plan" del frontend
// (camelCase). En el store mock los datos viven repartidos en dos
// estructuras (Plan + PlanMetadata); en DB se fusionan en una sola fila.
//
// Regla del DATA_CONTRACT: aquí ocurre la ÚNICA traducción de nombres.
// Los VALORES de enum NO se traducen (la DB ya guarda 'PPPoE', 'Residencial', …).
// ====================================================================

import { Plan } from '../../../src/types';
import { PlanMetadata } from '../../state/store';

export type PlanBusinessType = PlanMetadata['businessType']; // 'Residencial' | 'Empresarial' | 'Dedicado'
export type PlanTechType = Plan['type'];                     // 'PPPoE' | 'Hotspot' | 'DHCP' | 'Static'

// Objeto de dominio combinado: lo que la API v1 expone hoy ({ ...plan, isActive, businessType }).
export interface PlanRecord extends Plan {
  businessType: PlanBusinessType;
  isActive: boolean;
}

// Fila de DB (forma laxa: lo que devuelve supabase-js sin tipos generados).
// `price` es NUMERIC → puede llegar como string; se normaliza en rowToPlan.
export interface PlanRow {
  id: string;
  name: string;
  speed_down_mbps: number;
  speed_up_mbps: number;
  price: number | string;
  tech_type: PlanTechType;
  business_type: PlanBusinessType;
  is_active: boolean;
}

// --- DB -> App ---------------------------------------------------------
export const rowToPlan = (row: PlanRow): PlanRecord => ({
  id: row.id,
  name: row.name,
  speedMbpsDown: Number(row.speed_down_mbps),
  speedMbpsUp: Number(row.speed_up_mbps),
  price: Number(row.price),
  type: row.tech_type,
  businessType: row.business_type,
  isActive: row.is_active,
});

// --- App -> DB (alta: PlanRecord completo) ----------------------------
export const planToRow = (plan: PlanRecord): PlanRow => ({
  id: plan.id,
  name: plan.name,
  speed_down_mbps: plan.speedMbpsDown,
  speed_up_mbps: plan.speedMbpsUp,
  price: plan.price,
  tech_type: plan.type,
  business_type: plan.businessType,
  is_active: plan.isActive,
});

// --- App -> DB (edición: solo las claves presentes en el patch) -------
const CAMEL_TO_SNAKE: Partial<Record<keyof PlanRecord, keyof PlanRow>> = {
  name: 'name',
  speedMbpsDown: 'speed_down_mbps',
  speedMbpsUp: 'speed_up_mbps',
  price: 'price',
  type: 'tech_type',
  businessType: 'business_type',
  isActive: 'is_active',
};

export const planPatchToRow = (patch: Partial<PlanRecord>): Partial<PlanRow> => {
  const row: Partial<PlanRow> = {};
  for (const key of Object.keys(patch) as (keyof PlanRecord)[]) {
    const column = CAMEL_TO_SNAKE[key];
    if (!column) continue; // ignora claves desconocidas (p.ej. 'id')
    (row as Record<string, unknown>)[column] = (patch as Record<string, unknown>)[key];
  }
  return row;
};

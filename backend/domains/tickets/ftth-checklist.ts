// ====================================================================
// Checklist de campo FTTH.
//
// Una instalación de fibra no se cierra "porque el técnico dijo que sí": se
// cierra con serie de ONU, puerto de CTO ocupado y una lectura de potencia
// óptica dentro de rango. Si la potencia está fuera de rango, la orden NO se
// puede completar — hay que revisar la fusión antes.
//
// Umbrales GPON de referencia (potencia de recepción en la ONU, dBm):
//   mejor que  -8  → demasiada señal, satura el receptor
//   -8 .. -25      → operación normal
//   -25 .. -27     → degradado: se cierra pero queda advertido
//   peor que -27   → inaceptable, bloquea el cierre
// ====================================================================

import { AppError } from '../../common/errors';
import type { FtthWorkOrderFields, TaskOrder, WorkOrderTechnology } from '../../../src/types';
// Umbrales compartidos con la app del técnico: una sola fuente de verdad.
import {
  classifyRxPower,
  FTTH_RX_POWER_MAX_DBM,
  FTTH_RX_POWER_MIN_DBM,
  FTTH_RX_POWER_WARN_DBM,
} from '../../../src/lib/ftthOptical';

export {
  classifyRxPower,
  FTTH_RX_POWER_MAX_DBM,
  FTTH_RX_POWER_MIN_DBM,
  FTTH_RX_POWER_WARN_DBM,
};

export const parseWorkOrderTechnology = (value: unknown): WorkOrderTechnology | null => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'fiber' || normalized === 'fibra' || normalized === 'ftth') return 'fiber';
  if (normalized === 'radio' || normalized === 'wisp' || normalized === 'inalambrico') return 'radio';
  return null;
};

/** Normaliza la captura de campo descartando valores vacíos o no numéricos. */
export const parseFtthFields = (value: unknown): FtthWorkOrderFields | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const num = (key: string): number | undefined => {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') return undefined;
    const parsed = Number(raw[key]);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const str = (key: string): string | undefined => {
    const text = raw[key] === undefined || raw[key] === null ? '' : String(raw[key]).trim();
    return text || undefined;
  };

  // Solo se incluyen las claves presentes: un patch parcial (p. ej. solo la
  // potencia) no debe borrar la serie de ONU ya capturada al mezclarse.
  const fields: FtthWorkOrderFields = {};
  const assign = <K extends keyof FtthWorkOrderFields>(
    key: K,
    value: FtthWorkOrderFields[K] | undefined,
  ): void => {
    if (value !== undefined) fields[key] = value;
  };

  assign('onuSerial', str('onuSerial'));
  assign('napId', str('napId'));
  assign('napPort', num('napPort'));
  assign('rxPowerDbm', num('rxPowerDbm'));
  assign('txPowerDbm', num('txPowerDbm'));
  assign('spliceLossDb', num('spliceLossDb'));
  assign('measuredAt', str('measuredAt'));

  return Object.keys(fields).length > 0 ? fields : undefined;
};

export interface FtthChecklistResult {
  ok: boolean;
  /** Motivos que impiden cerrar la orden. */
  errors: string[];
  /** Observaciones que no bloquean (p. ej. potencia degradada). */
  warnings: string[];
  code?: 'FTTH_CHECKLIST_INCOMPLETE' | 'FTTH_RX_POWER_OUT_OF_RANGE';
}

/**
 * Verifica si una orden de fibra puede cerrarse. Las órdenes de radio (o sin
 * tecnología declarada) pasan sin condiciones: este gate no cambia el flujo
 * inalámbrico existente.
 */
export const validateFtthCompletion = (
  order: Pick<TaskOrder, 'technology' | 'ftth'>,
): FtthChecklistResult => {
  if (order.technology !== 'fiber') return { ok: true, errors: [], warnings: [] };

  const fields = order.ftth ?? {};
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fields.onuSerial) errors.push('Falta el número de serie de la ONU.');
  if (!fields.napId) errors.push('Falta la caja NAP/CTO utilizada.');
  if (fields.napPort === undefined) errors.push('Falta el puerto de la NAP/CTO.');
  else if (!Number.isInteger(fields.napPort) || fields.napPort < 1) {
    errors.push('El puerto de la NAP/CTO debe ser un entero positivo.');
  }

  if (fields.rxPowerDbm === undefined) {
    errors.push('Falta la lectura de potencia óptica (Rx dBm).');
    return { ok: false, errors, warnings, code: 'FTTH_CHECKLIST_INCOMPLETE' };
  }

  const incomplete = errors.length > 0;
  const classification = classifyRxPower(fields.rxPowerDbm);

  if (classification === 'too_low') {
    errors.push(
      `Potencia de recepción ${fields.rxPowerDbm} dBm por debajo del mínimo ` +
        `(${FTTH_RX_POWER_MIN_DBM} dBm): revisar la fusión antes de cerrar.`,
    );
  } else if (classification === 'too_high') {
    errors.push(
      `Potencia de recepción ${fields.rxPowerDbm} dBm demasiado alta ` +
        `(máximo ${FTTH_RX_POWER_MAX_DBM} dBm): satura el receptor de la ONU.`,
    );
  } else if (classification === 'degraded') {
    warnings.push(
      `Potencia ${fields.rxPowerDbm} dBm en zona degradada ` +
        `(${FTTH_RX_POWER_WARN_DBM}..${FTTH_RX_POWER_MIN_DBM} dBm): instalación con poco margen.`,
    );
  }

  if (errors.length === 0) return { ok: true, errors, warnings };

  return {
    ok: false,
    errors,
    warnings,
    // Si además faltaban datos, el motivo principal sigue siendo el checklist.
    code: incomplete ? 'FTTH_CHECKLIST_INCOMPLETE' : 'FTTH_RX_POWER_OUT_OF_RANGE',
  };
};

/**
 * 422: la petición es sintácticamente válida pero la instalación no cumple los
 * requisitos de entrega. El detalle lista qué falta para que el técnico lo vea
 * en la app sin adivinar.
 */
export class FtthChecklistError extends AppError {
  constructor(result: FtthChecklistResult) {
    super(
      422,
      result.errors[0] ?? 'La orden de fibra no cumple los requisitos de cierre',
      result.code ?? 'FTTH_CHECKLIST_INCOMPLETE',
      { errors: result.errors, warnings: result.warnings },
    );
    this.name = 'FtthChecklistError';
  }
}

// ====================================================================
// Umbrales de potencia óptica GPON — fuente única para backend y frontend.
//
// El backend los usa para bloquear el cierre de una orden de fibra
// (backend/domains/tickets/ftth-checklist.ts) y la app del técnico para
// colorear la lectura mientras la captura. Si divergen, el técnico ve verde
// algo que el servidor rechaza.
// ====================================================================

/** Potencia mínima aceptable en la ONU: por debajo no se cierra la orden. */
export const FTTH_RX_POWER_MIN_DBM = -27;
/** A partir de aquí la instalación queda advertida (poco margen). */
export const FTTH_RX_POWER_WARN_DBM = -25;
/** Máximo: más señal que esto satura el receptor de la ONU. */
export const FTTH_RX_POWER_MAX_DBM = -8;

export type RxPowerClassification = 'good' | 'degraded' | 'too_low' | 'too_high';

export const classifyRxPower = (rxPowerDbm: number): RxPowerClassification => {
  if (rxPowerDbm > FTTH_RX_POWER_MAX_DBM) return 'too_high';
  if (rxPowerDbm < FTTH_RX_POWER_MIN_DBM) return 'too_low';
  if (rxPowerDbm < FTTH_RX_POWER_WARN_DBM) return 'degraded';
  return 'good';
};

export const RX_POWER_LABELS: Record<RxPowerClassification, string> = {
  good: 'Potencia en rango',
  degraded: 'Degradada: poco margen',
  too_low: 'Muy baja: revisar fusión',
  too_high: 'Muy alta: satura la ONU',
};

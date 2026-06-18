// ====================================================================
// Métricas en memoria mínimas para observabilidad (checklist §14).
//
// Contadores process-local (se reinician con el contenedor). Suficiente
// como base para healthcheck y futuras alertas por 4xx/5xx y latencia. NO
// sustituye a un backend de métricas real (Prometheus/etc.), que llegará
// más adelante.
// ====================================================================

let requestsTotal = 0;
let errors4xx = 0;
let errors5xx = 0;
let latencySumMs = 0;
let latencyCount = 0;
let maxLatencyMs = 0;

export interface MetricsSnapshot {
  requestsTotal: number;
  errors4xx: number;
  errors5xx: number;
  /** Latencia media por petición observada, en ms (0 si no hay muestras). */
  avgLatencyMs: number;
  /** Latencia máxima observada, en ms. */
  maxLatencyMs: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const metrics = {
  countRequest(): void {
    requestsTotal += 1;
  },
  count4xx(): void {
    errors4xx += 1;
  },
  count5xx(): void {
    errors5xx += 1;
  },
  /** Registra la duración de una petición. Ignora valores no finitos/negativos. */
  observeLatency(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    latencySumMs += ms;
    latencyCount += 1;
    if (ms > maxLatencyMs) maxLatencyMs = ms;
  },
  snapshot(): MetricsSnapshot {
    return {
      requestsTotal,
      errors4xx,
      errors5xx,
      avgLatencyMs: latencyCount > 0 ? round2(latencySumMs / latencyCount) : 0,
      maxLatencyMs: round2(maxLatencyMs),
    };
  },
  reset(): void {
    requestsTotal = 0;
    errors4xx = 0;
    errors5xx = 0;
    latencySumMs = 0;
    latencyCount = 0;
    maxLatencyMs = 0;
  },
};

// ====================================================================
// Métricas en memoria mínimas para observabilidad (checklist §14).
//
// Contadores process-local (se reinician con el contenedor). Suficiente
// como base para healthcheck y futuras alertas por 5xx. NO sustituye a un
// backend de métricas real (Prometheus/etc.), que llegará más adelante.
// ====================================================================

let requestsTotal = 0;
let errors5xx = 0;

export interface MetricsSnapshot {
  requestsTotal: number;
  errors5xx: number;
}

export const metrics = {
  countRequest(): void {
    requestsTotal += 1;
  },
  count5xx(): void {
    errors5xx += 1;
  },
  snapshot(): MetricsSnapshot {
    return { requestsTotal, errors5xx };
  },
  reset(): void {
    requestsTotal = 0;
    errors5xx = 0;
  },
};

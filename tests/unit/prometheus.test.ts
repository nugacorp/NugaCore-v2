import { describe, it, expect } from 'vitest';
import { renderPrometheusMetrics } from '../../backend/common/prometheus';
import { metrics } from '../../backend/common/metrics';

describe('prometheus exporter', () => {
  it('renderiza métricas en formato Prometheus', () => {
    metrics.reset();
    metrics.countRequest();
    metrics.observeLatency(12.5);
    const body = renderPrometheusMetrics();
    expect(body).toContain('# TYPE nugacore_http_requests_total counter');
    expect(body).toContain('nugacore_http_requests_total 1');
    expect(body).toContain('nugacore_http_request_duration_ms_avg 12.5');
    expect(body).toContain('nugacore_process_uptime_seconds');
  });
});

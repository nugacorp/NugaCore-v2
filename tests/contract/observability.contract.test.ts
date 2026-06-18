import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/app';
import { metrics } from '../../backend/common/metrics';

// ====================================================================
// Fase 4.9.2.5 - Observabilidad (14): correlation ID + metricas.
// ====================================================================

describe('Observabilidad - correlation ID (X-Request-Id)', () => {
  it('genera un X-Request-Id cuando no viene en la peticion', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    const id = res.headers['x-request-id'];
    expect(typeof id).toBe('string');
    expect((id || '').length).toBeGreaterThan(0);
  });

  it('propaga el X-Request-Id entrante (saneado) en la respuesta', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'trace-abc_123.45');
    expect(res.headers['x-request-id']).toBe('trace-abc_123.45');
  });

  it('ignora un X-Request-Id con caracteres no seguros y genera uno nuevo', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'con espacios y $imbolos');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).not.toBe('con espacios y $imbolos');
  });
});

describe('Observabilidad - metricas', () => {
  it('GET /api/health expone metricas numericas', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.body.metrics).toBeDefined();
    expect(typeof res.body.metrics.requestsTotal).toBe('number');
    expect(typeof res.body.metrics.errors4xx).toBe('number');
    expect(typeof res.body.metrics.errors5xx).toBe('number');
    expect(typeof res.body.metrics.avgLatencyMs).toBe('number');
    expect(typeof res.body.metrics.maxLatencyMs).toBe('number');
  });

  it('count5xx incrementa el contador de 5xx', () => {
    const before = metrics.snapshot().errors5xx;
    metrics.count5xx();
    expect(metrics.snapshot().errors5xx).toBe(before + 1);
  });

  it('count4xx incrementa el contador de 4xx', () => {
    const before = metrics.snapshot().errors4xx;
    metrics.count4xx();
    expect(metrics.snapshot().errors4xx).toBe(before + 1);
  });

  it('countRequest incrementa el total de peticiones', () => {
    const before = metrics.snapshot().requestsTotal;
    metrics.countRequest();
    expect(metrics.snapshot().requestsTotal).toBe(before + 1);
  });

  it('observeLatency calcula media y maximo; ignora valores invalidos', () => {
    metrics.reset();
    metrics.observeLatency(10);
    metrics.observeLatency(30);
    metrics.observeLatency(-5); // ignorado
    metrics.observeLatency(Number.NaN); // ignorado
    const snap = metrics.snapshot();
    expect(snap.avgLatencyMs).toBe(20);
    expect(snap.maxLatencyMs).toBe(30);
    metrics.reset();
    expect(metrics.snapshot().avgLatencyMs).toBe(0);
    expect(metrics.snapshot().maxLatencyMs).toBe(0);
  });

  it('una peticion 4xx (ruta inexistente) incrementa errors4xx', async () => {
    const app = createApp();
    metrics.reset();
    const res = await request(app).get('/api/__ruta_inexistente__');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // El evento 'finish' del servidor puede emitirse justo tras resolver supertest.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(metrics.snapshot().errors4xx).toBeGreaterThanOrEqual(1);
    expect(metrics.snapshot().errors5xx).toBe(0);
  });
});

describe('Observabilidad - access log de finalizacion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const findCompletionLine = (spy: ReturnType<typeof vi.spyOn>): string | undefined => {
    for (const call of spy.mock.calls) {
      const line = call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
      if (line.includes('request completed')) return line;
    }
    return undefined;
  };

  it('emite "request completed" con status y duracion al finalizar la peticion', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    // El evento 'finish' puede emitirse justo tras resolver supertest.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const line = findCompletionLine(logSpy);
    expect(line).toBeDefined();
    expect(line).toContain('"status":200');
    expect(line).toContain('"path":"/api/health"');
    expect(line).toContain('"durationMs"');
  });
});

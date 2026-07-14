# Observabilidad — Access log de finalización por petición

> Fase 4.9.2.5 (Production Readiness Manual Safe Mode) · Checklist §14.
> Trabajo local seguro: código + tests + documentación. No toca infraestructura,
> routers, datos reales ni flags peligrosos.

## Qué existe hoy

- Correlation ID por petición (`backend/common/request-context.ts`):
  - Lee `X-Request-Id` entrante (saneado por allowlist) o genera un UUID.
  - Lo expone en `req.requestId`, en un child logger `req.log` y en la cabecera
    de respuesta `X-Request-Id`.
- Métricas en memoria (`backend/common/metrics.ts`): `requestsTotal`,
  `errors4xx`, `errors5xx`, `avgLatencyMs`, `maxLatencyMs`, expuestas en
  `/api/health`.
- **Nuevo:** access log estructurado de finalización. En el evento `finish` de
  cada respuesta se emite `req.log.info('request completed', { method, path,
  status, durationMs })`. Sale como JSON en producción (`LOG_FORMAT=json`) y
  correlacionado por `requestId`.

## Por qué

El logger ya soportaba JSON y se registraba el inicio de la petición, pero no
había una línea de cierre con código de estado y latencia por petición. Ese
access log es la primitiva que un operador necesita para correlacionar latencia
y errores con un `requestId` concreto, y completa el item §14 "Logs JSON
estructurados".

## Higiene de seguridad

- El access log incluye solo `method`, `path` (ruta, no URL completa), `status`
  y `durationMs`. No registra query string, headers, body ni `Authorization`.
- No imprime secretos, tokens ni scripts.

## Verificación

```bash
npm run typecheck   # PASS (sin errores)
npm test            # PASS (1016 passed, 46 skipped; 0 failed)
npm run build       # compila/bundlea OK (cliente + server.cjs ~454kb)
```

Nota de entorno: `npm run build` in-place puede fallar al vaciar `dist/` por un
`EPERM unlink` sobre un artefacto bloqueado en el filesystem montado (Windows).
No es un defecto de código: el build compila y empaqueta correctamente cuando se
dirige la salida a un directorio limpio. No se forzó el borrado del `dist/`
existente.

Test añadido: `tests/contract/observability.contract.test.ts` →
"emite \"request completed\" con status y duracion al finalizar la peticion".

## Estado

PARCIAL respecto a §14 (Observabilidad). Cerrados en este cambio:

- [x] Logs JSON estructurados.
- [x] Request ID/correlation ID.

Sigue pendiente en §14 (no abordado aquí): métricas de DB, métricas de workers,
alertas por 5xx/jobs, dashboard de operación, retención de logs, y un backend de
métricas real (Prometheus/etc.) que sustituya al contador en memoria.

## Siguiente paso recomendado

La prioridad inmediata del proyecto (cerrar Fase 4.9.2 con WireGuard
post-restart) requiere staging real, migración y restart de contenedor:
**requiere autorización explícita de Ramiro** y no puede ejecutarse de forma
autónoma. Mientras tanto, el siguiente trabajo local seguro dentro de 4.9.2.5
es continuar §14 (p. ej. estructurar métricas de DB) o avanzar runbooks.

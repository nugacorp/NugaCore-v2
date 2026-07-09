# NugaCore — Runbook de Respuesta a Incidentes

## Clasificación

| Severidad | Ejemplo | Acción |
|-----------|---------|--------|
| P1 | API caída, DB inaccesible, fuga de secretos | Escalar inmediato, rollback |
| P2 | 5xx sostenidos, jobs fallidos, degradación NOC | Investigar en 30 min |
| P3 | Warning de consistencia, métricas elevadas | Ticket programado |

## P1 — API no responde

1. `curl -fsS $APP_URL/api/health/live` — ¿proceso vivo?
2. Coolify → Logs del contenedor (buscar `fail-fast`, errores Supabase).
3. Si deploy reciente: **rollback** al deployment anterior.
4. `APP_URL=... bash scripts/vps/validate-production.sh`
5. Documentar commit, hora, causa raíz preliminar.

## P1 — Supabase inaccesible

1. `GET /api/health/ready` → esperado 503 con `supabaseReachable: false`.
2. Verificar status de Supabase (dashboard del proveedor).
3. No aplicar migraciones hasta restablecer conectividad.
4. Si corrupción de datos: seguir `docs/BACKUP_RESTORE_RUNBOOK.md`.

## P2 — Errores 5xx elevados

1. Revisar logs JSON (`errors5xx` en `/api/health` o Prometheus).
2. Identificar ruta (`path` en access log `request completed`).
3. Correlacionar con `X-Request-Id`.
4. Si relacionado con webhook: verificar firma y `WEBHOOK_SECRET_*`.

## P2 — Fuga de secretos sospechada

1. Rotar **todos** los secretos de la tabla en `SECRET_ROTATION_RUNBOOK.md`.
2. Revisar logs: no deben contener JWT ni `Authorization: Bearer`.
3. Invalidar sesiones en Supabase si aplica.

## Post-incidente

- Actualizar `docs/PRODUCTION_READINESS_CHECKLIST.md` si un gate falló.
- Crear documento `docs/INCIDENT_YYYYMMDD_RESULT.md` (sanitizado, sin secretos).

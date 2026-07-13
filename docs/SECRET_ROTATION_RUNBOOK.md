# NugaCore — Runbook de Rotación de Secretos (SEC-3)

Rotar periódicamente (recomendado: cada 90 días o tras incidente).

## Secretos a rotar

| Secreto | Dónde | Impacto |
|---------|-------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard + Coolify | Reinicio backend; invalida sesiones service-role |
| `MIKROTIK_CREDENTIALS_KEY` | Coolify | Re-cifrar credenciales almacenadas si aplica |
| `WEBHOOK_SECRET_*` | Coolify + proveedor de pagos | Actualizar HMAC en gateway de webhooks |
| `METRICS_BEARER_TOKEN` | Coolify + Prometheus scraper | Actualizar scraper |
| `GEMINI_API_KEY` | Coolify | Solo copiloto IA |

## Procedimiento genérico

1. Generar nuevo secreto en el origen (Supabase, proveedor, `openssl rand -base64 48`).
2. Añadir el nuevo valor en Coolify como secret de runtime (no commitear).
3. Redeploy de la aplicación.
4. Ejecutar `bash scripts/smoke-production.sh $APP_URL`.
5. Revocar el secreto anterior en el origen.
6. Registrar fecha y responsable en el log de operaciones interno (no en GitHub público).

## Supabase service role

1. Supabase → Settings → API → rotar service role key.
2. Actualizar `SUPABASE_SERVICE_ROLE_KEY` en Coolify.
3. Redeploy.
4. Verificar `GET /api/health/ready` → 200 con flags DB activos.

## Webhooks de pago

1. Generar nuevo `WEBHOOK_SECRET_MANUAL` (u otro proveedor).
2. Configurar en Coolify y en el panel del proveedor.
3. Enviar webhook de prueba; esperar 400 sin firma, 2xx con firma válida.
4. Revocar secreto anterior en el proveedor.

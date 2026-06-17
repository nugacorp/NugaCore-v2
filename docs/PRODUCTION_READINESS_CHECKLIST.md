# NugaCore — Production Readiness Checklist

> Checklist obligatorio para llevar NugaCore desde staging/lab hasta producción real en un WISP.
>
> Este documento está escrito para técnicos, Hermes, Jarvis y Claude Code. Si una tarea no está marcada, no debe asumirse lista. No avanzar a acciones reales sobre routers sin cumplir los gates correspondientes.

## Ley principal

Producción no significa “funciona en staging”. Producción significa:

- Persiste después de restart/deploy.
- Tiene pruebas automatizadas.
- Tiene pruebas funcionales reales.
- Tiene rollback o recuperación documentada.
- No expone secretos.
- No depende de memoria local para estado crítico.
- No toca routers reales sin autorización, dry-run, confirmación y auditoría.

## Estados de checklist

Usar estos estados al actualizar el documento:

- `[ ]` Pendiente.
- `[~]` En progreso o parcialmente validado.
- `[x]` Completado y verificado con evidencia.
- `[!]` Bloqueado; requiere decisión/corrección.

Markdown estándar no soporta `[~]`/`[!]` como checkbox visual en GitHub, pero se usan como convención textual en este repo.

## 0. Guardrails permanentes

Estos puntos aplican a toda fase.

- [ ] No imprimir secretos en logs, terminal, documentación ni issues.
- [ ] No commitear tokens, JWT, service role, private keys, preshared keys, passwords ni archivos `.env` reales.
- [ ] No guardar scripts RouterOS completos en DB.
- [ ] No importar scripts `.rsc` en routers reales desde staging.
- [ ] No activar `MIKROTIK_WORKER_LIVE` sin fase aprobada.
- [ ] No activar commit mode sin rollback probado.
- [ ] No activar `USE_DB_MIKROTIK` como workaround para otro problema.
- [ ] No usar datos mock inconsistentes en producción.
- [ ] No borrar datos reales sin backup, plan y autorización explícita.
- [ ] Toda acción peligrosa debe tener RBAC, confirmación humana y auditoría.

## 1. Baseline técnico mínimo

- [ ] `npm install` reproducible.
- [ ] `npm run typecheck` pasa.
- [ ] `npm test` pasa.
- [ ] `npm run build` pasa.
- [ ] `RUN_DB_TESTS=true npm run test:db` pasa cuando la fase toca DB.
- [ ] Scripts de validación específicos pasan, por ejemplo:
  - [ ] `RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs`
  - [ ] `RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs`
- [ ] CI ejecuta typecheck, tests y build antes de merge/deploy.
- [ ] README enlaza roadmap y checklist de producción.
- [ ] Cada fase tiene documento de resultado o aprobación cuando se cierra.

## 2. Separación staging / producción

- [ ] Supabase staging y producción separados.
- [ ] Coolify staging y producción separados o claramente aislados.
- [ ] Variables de entorno separadas por ambiente.
- [ ] Datos mock/fixtures no migran a producción.
- [ ] Usuarios staging no existen en producción.
- [ ] Deploy producción requiere commit/tag aprobado.
- [ ] Migraciones producción se aplican con backup previo.
- [ ] Rollback documentado.

## 3. Auth, RBAC y seguridad HTTP

Estado actual: funcionalmente avanzado; producción requiere hardening final.

Checklist:

- [ ] Todos los endpoints `/api/*` sensibles exigen JWT Supabase válido.
- [ ] `AUTH_TRUST_HEADERS=false` en producción.
- [ ] Roles se resuelven desde DB (`user_roles`/`roles`), no desde headers manipulables.
- [ ] Super Admin, Administrador, Técnico, Cobranza, Soporte y Solo lectura probados con usuarios reales.
- [ ] Cada rol tiene pruebas de allow/deny por endpoint crítico.
- [ ] Frontend no muestra acciones no permitidas.
- [ ] Backend devuelve 403 aunque el frontend oculte botones.
- [ ] CORS allowlist configurado.
- [ ] Rate limit configurado.
- [ ] Helmet/security headers configurados.
- [ ] HTTPS/HSTS activo.
- [ ] Sesión/token manejados con estrategia aceptada para producción.
- [ ] Logs sin JWT ni `Authorization: Bearer`.

Comandos sugeridos:

```bash
npm run typecheck
npm test
RUN_AUTH_TESTS=true npm run test:auth
```

## 4. Persistencia y eliminación de stores en memoria

Objetivo: ningún estado crítico debe perderse al reiniciar contenedor.

- [ ] Clientes persistidos en DB y validados con restart.
- [ ] Planes persistidos en DB y validados con restart.
- [ ] Billing persistido en DB y validado con restart.
- [ ] Payment Engine persistido en DB y validado con restart.
- [ ] Suspension Engine persistido en DB antes de cualquier acción real.
- [ ] Router Enrollment persistido en DB.
- [ ] WireGuard Manager persistido en DB o snapshot suficiente para re-download.
- [ ] MikroTik provisioning metadata persistida en DB antes de live.
- [ ] No queda dependencia de `store.ts` para flujos productivos.

Criterio de prueba por dominio:

1. Crear recurso con API autenticada.
2. Leer recurso con API.
3. Reiniciar contenedor.
4. Leer recurso nuevamente.
5. Ejecutar la acción principal post-restart.
6. Confirmar que funciona sin memoria previa.
7. Limpiar solo recursos test creados.

## 5. Supabase y migraciones

- [ ] Todas las migraciones aplican en DB limpia.
- [ ] Todas las migraciones aplican idempotentemente en staging existente.
- [ ] Migraciones evolutivas usan `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` cuando hay tablas legacy.
- [ ] No hay `DROP TABLE`/`DROP COLUMN` sin autorización y backup.
- [ ] PostgREST reload después de migraciones: `NOTIFY pgrst, 'reload schema';`.
- [ ] Validadores de schema pasan.
- [ ] RLS revisado por tabla sensible.
- [ ] Service role solo en backend.
- [ ] Backups antes de migraciones producción.

Comandos base:

```bash
supabase db query --linked --file supabase/migrations/<migration>.sql
supabase db query --linked "NOTIFY pgrst, 'reload schema';"
RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs
RUN_DB_TESTS=true npm run test:db
```

## 6. Billing y pagos

- [ ] Clientes reales importados y auditados.
- [ ] Planes reales importados y auditados.
- [ ] Facturas reales importadas o generadas de forma consistente.
- [ ] Facturas huérfanas = 0.
- [ ] Pagos huérfanos = 0.
- [ ] `balance_cents`, `applied_cents`, `total_cents` validados.
- [ ] Pagos parciales y completos probados.
- [ ] Cancelación/edición de factura con permisos correctos.
- [ ] Webhooks reales firmados y validados.
- [ ] Idempotencia de webhooks probada.
- [ ] Reactivación lógica no ocurre sin pago/factura causal.
- [ ] Logs sin datos sensibles de proveedores de pago.
- [ ] Si hay CFDI/PAC: timbrado real validado en ambiente seguro antes de producción.

## 7. Suspension Engine

Estado producción actual: no activar contra routers reales.

- [ ] Engine lee DB real, no store mock.
- [ ] Clasificación de morosos probada con datos reales controlados.
- [ ] Reactivación vinculada a pago/factura causal.
- [ ] Órdenes generadas como pendientes, no ejecución directa.
- [ ] RBAC por acción probado.
- [ ] Dry-run visible y auditable.
- [ ] Idempotencia de evaluate-all probada.
- [ ] Limpieza de escenarios test probada.
- [ ] No toca RouterOS hasta aprobar Worker live.

## 8. WireGuard Manager

Bloqueante actual para Router Enrollment producción.

- [ ] `USE_DB_WIREGUARD=true` implementado y validado en staging, o alternativa `wireguard_snapshot` suficiente.
- [ ] WireGuard server default persistido.
- [ ] Peers persistidos.
- [ ] IPAM persistente.
- [ ] Revocación persistente.
- [ ] Rotación de keys persistente.
- [ ] Reutilización de peer existente tras restart.
- [ ] Re-download de scripts tras restart no falla por `Servidor WireGuard no encontrado`.
- [ ] Logs sin private keys/preshared keys.
- [ ] No exponer claves privadas en list/detail.

Test mínimo:

1. Crear servidor WG test/default en staging.
2. Crear enrollment.
3. Reiniciar contenedor.
4. Descargar script.
5. Esperado: HTTP 200, no 404.
6. Script contiene marcadores esperados, sin imprimirlo completo.

## 9. Router Enrollment / Dynamic Parameters

Estado actual: avanzado, bloqueado para producción por dependencia WireGuard post-restart.

- [ ] `router_enrollment` existe en Supabase.
- [ ] `template_parameters` existe.
- [ ] `router_snapshot` existe.
- [ ] `script_hash` existe.
- [ ] Columna `script` NO existe.
- [ ] `router_snapshot` no contiene passwords/private keys/preshared keys/scripts/tokens.
- [ ] `POST /api/router-enrollment/start` con `templateId=pcc_5wan` devuelve 201.
- [ ] `GET /api/router-enrollment/:id` devuelve templateParameters correctos.
- [ ] Restart real del contenedor.
- [ ] `GET /api/router-enrollment/:id` post-restart devuelve 200.
- [ ] `GET /api/router-enrollment/:id/download` post-restart devuelve 200.
- [ ] Download post-restart contiene LAN/interfaz/gateway custom.
- [ ] Download post-restart no imprime script completo en logs.
- [ ] Legacy sin snapshot devuelve error controlado, no 500.
- [ ] Cleanup de enrollment/routers/peers test.

Caso de aceptación 4.9.2:

```json
{
  "templateId": "pcc_5wan",
  "templateParameters": {
    "lanCidr": "10.77.0.1/24",
    "wan1": {
      "mode": "static",
      "interface": "sfp1",
      "gateway": "200.1.1.1"
    }
  }
}
```

Debe sobrevivir a restart y permitir download con esos valores.

## 10. RouterOS Templates

- [ ] Cada plantilla tiene schema de parámetros.
- [ ] Cada plantilla tiene tests unitarios de generación.
- [ ] RouterOS v6/v7 preservado.
- [ ] Preview redactado.
- [ ] Script completo solo en respuesta inicial/download autorizado.
- [ ] No guardar script completo en DB.
- [ ] No loguear script completo.
- [ ] Validación de parámetros devuelve 400 controlado.

## 11. MikroTik Worker y RouterOS real

No producción hasta que esta sección esté completa.

- [ ] Worker separado del proceso web.
- [ ] Conector RouterOS probado primero en CHR/lab.
- [ ] API TLS preferida (`8729`) o decisión explícita si lab usa `8728`.
- [ ] Credenciales cifradas.
- [ ] Comandos allowlist.
- [ ] Dry-run antes de live.
- [ ] Confirmación humana para escritura.
- [ ] Cola de comandos.
- [ ] Timeouts y reintentos.
- [ ] Auditoría por comando.
- [ ] Backup/export antes de cambios peligrosos.
- [ ] Rollback documentado.
- [ ] `MIKROTIK_WORKER_LIVE` solo en piloto controlado.
- [ ] `COMMIT_MODE` solo con rollback.

Secuencia segura:

1. CHR/lab read-only.
2. CHR/lab dry-run writes.
3. CHR/lab live writes controlados.
4. Router real no crítico read-only.
5. Router real no crítico acción pequeña.
6. Producción gradual.

## 12. NOC read-only

Recomendado antes de Command Center live.

- [ ] Inventario de routers/towers/peers visible.
- [ ] Health real read-only.
- [ ] Ping/latencia.
- [ ] CPU/RAM/uptime.
- [ ] Interfaces.
- [ ] PPP/queues read-only.
- [ ] WireGuard peers.
- [ ] Alertas con rate limit.
- [ ] Telegram/email/push configurados sin exponer secretos.
- [ ] Dashboard no muestra PII innecesaria.
- [ ] Resumen NOC sanitizado para agentes IA.

## 13. Inventario, tickets, CRM y portal

Inventario:

- [ ] Modelo de equipos real.
- [ ] Entradas/salidas.
- [ ] Series/garantías.
- [ ] Asignación a cliente/sitio/router.
- [ ] Historial no destructivo.

Tickets:

- [ ] CRUD tickets.
- [ ] SLA.
- [ ] Asignación técnico.
- [ ] Historial/comentarios.
- [ ] Adjuntos seguros.

CRM:

- [ ] Prospectos.
- [ ] Cotizaciones.
- [ ] Instalaciones.
- [ ] Agenda.

Portal Cliente:

- [ ] Facturas.
- [ ] Pagos.
- [ ] Estado servicio.
- [ ] Tickets.
- [ ] Datos personales protegidos.

## 14. Observabilidad

- [ ] Logs JSON estructurados.
- [ ] Request ID/correlation ID.
- [ ] Métricas de API.
- [ ] Métricas de DB.
- [ ] Métricas de workers.
- [ ] Healthchecks internos y externos.
- [ ] Alertas por errores 5xx.
- [ ] Alertas por jobs fallidos.
- [ ] Dashboard de operación.
- [ ] Retención de logs definida.
- [ ] Logs sin secretos.

## 15. Backups y restore

Bloqueante para producción real.

- [ ] Backup automático DB configurado.
- [ ] Retención definida.
- [ ] Backup manual antes de migraciones.
- [ ] Restore probado en ambiente separado.
- [ ] Runbook de restore escrito.
- [ ] Tiempo objetivo de recuperación definido.
- [ ] Se sabe qué datos se pierden si falla el último backup.
- [ ] Backups de configuración crítica fuera del repo y cifrados.

## 16. Deploy y rollback

- [ ] Pipeline CI verde antes de deploy.
- [ ] Build reproducible.
- [ ] Imagen/tag asociado a commit.
- [ ] Deploy staging antes de producción.
- [ ] Migraciones aplicadas en orden.
- [ ] Healthchecks post-deploy.
- [ ] Smoke tests post-deploy.
- [ ] Rollback documentado.
- [ ] Rollback probado.
- [ ] No force-push/amend en ramas de release.

## 17. Documentación obligatoria por fase

Cada fase que se cierre debe tener un documento en `docs/` con:

- Commit validado.
- Migrations aplicadas.
- Flags activos/inactivos.
- Tests ejecutados.
- Resultados de healthchecks.
- Pruebas funcionales.
- Seguridad/log hygiene.
- Cleanup realizado.
- Resultado final: APROBADA / NO APROBADA.
- Próximo paso recomendado.

## 18. Gate para primer uso real en el WISP

NugaCore puede entrar a primer uso real solamente en modo manual/read-only cuando:

- [ ] Auth/RBAC producción listo.
- [ ] Clientes/planes/billing con datos reales validados.
- [ ] Backups/restore probados.
- [ ] Router Enrollment no pierde capacidad de download tras restart.
- [ ] WireGuard no depende de memoria para flujos críticos.
- [ ] NOC read-only básico disponible o planificado inmediatamente.
- [ ] No Worker live.
- [ ] No commit mode.
- [ ] Runbooks escritos.
- [ ] Técnico responsable entiende qué puede y no puede tocar.

## 19. Gate para automatización real

No activar automatización real sobre MikroTik hasta que:

- [ ] Primer uso read-only/manual esté estable.
- [ ] CHR/lab haya pasado pruebas live.
- [ ] Worker separado esté probado.
- [ ] Cola de comandos esté probada.
- [ ] Auditoría esté persistida.
- [ ] Rollback esté probado.
- [ ] Backups/export RouterOS estén documentados.
- [ ] Piloto en router no crítico aprobado.
- [ ] Se tenga autorización explícita del operador.

## 20. Comandos estándar de verificación

```bash
# Repo
cd /opt/nugacore-staging
git status --short --branch
git log --oneline -8

# Calidad local
npm run typecheck
npm test
npm run build

# DB
RUN_DB_TESTS=true npm run test:db
RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs
RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs

# Health staging
curl -fsS https://nugacore-staging.5.180.151.109.sslip.io/api/health
curl -fsS https://nugacore-staging.5.180.151.109.sslip.io/api/health/live
curl -fsS https://nugacore-staging.5.180.151.109.sslip.io/api/health/ready
```

No pegar en issues/docs la salida completa si contiene secretos, scripts o payloads sensibles. Resumir PASS/FAIL y códigos HTTP.

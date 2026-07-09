# NugaCore — Runbook de Backup y Restore

**Alcance:** Supabase (PostgreSQL) + configuración Coolify.  
**Bloqueante:** `PRODUCTION_RESTORE_TESTED=true` solo tras restore exitoso.

## 1. Backup automático (Supabase)

1. En el dashboard de Supabase → **Database → Backups**.
2. Confirmar backups diarios habilitados y retención acordada (mínimo 7 días).
3. Antes de cada migración en producción: **backup manual** adicional.

## 2. Backup manual pre-migración

```bash
# Desde máquina con supabase CLI vinculada al proyecto PROD
supabase db dump --linked -f backup-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Guardar el archivo fuera del repo, cifrado, con registro de commit y migración asociada.

## 3. Restore en entorno de prueba

1. Crear proyecto Supabase temporal o restaurar en staging aislado.
2. Aplicar el dump o usar la función de restore del proveedor.
3. Apuntar una instancia NugaCore de prueba a esa DB.
4. Ejecutar:

```bash
STAGING_URL=https://... \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/vps/staging-restore-smoke.mjs
```

5. Verificar `GET /api/health/ready` → 200 y datos críticos legibles.

## 4. Marcar restore probado

En Coolify (producción), solo tras evidencia:

```env
PRODUCTION_RESTORE_TESTED=true
```

Validar:

```bash
PRODUCTION_RESTORE_TESTED=true node scripts/validate-restore-checklist.mjs
AUTH_BEARER=<jwt> APP_URL=https://prod... node scripts/validate-production-readiness.mjs
```

## 5. Qué se pierde si falla el último backup

Documentar por tabla crítica: clientes, facturas, pagos, enrollments, tickets.  
El RPO objetivo debe quedar acordado con operaciones (recomendado: ≤ 24 h con backup diario).

## 6. Rollback de aplicación (sin tocar DB)

1. Coolify → Deployments → rollback al commit/tag anterior.
2. `APP_URL=... bash scripts/vps/validate-production.sh`
3. Si la migración ya se aplicó y es incompatible: restaurar DB desde backup (sección 3).

# Staging — Flags WISP OS (OLA 0)

Plantilla recomendada para activar persistencia crítica en staging. **No usar en producción sin validar restore.**

```env
USE_DB_CUSTOMERS=true
USE_DB_PLANS=true
USE_DB_BILLING=true
USE_DB_PAYMENTS=true
USE_DB_INVENTORY=true
USE_DB_SUPPORT=true
USE_DB_COMMERCIAL=true
USE_DB_PURCHASES=true
USE_DB_FINANCE=true

# Activar tras migración suspension validada:
# USE_DB_SUSPENSION=true

# Red — tras aplicar migraciones towers/sectors:
# USE_DB_NETWORK=true
# USE_DB_FTTH=true

# NUNCA sin autorización:
# USE_DB_MIKROTIK=false
# MIKROTIK_WORKER_LIVE=false
```

## Checklist OLA 0

1. Aplicar migraciones: `20260707000000_crm_erp_wisp_schema.sql`, `20260707100000_wisp_os_schema.sql`, `20260707120000_ola6_radius_tenancy.sql`
2. `GET /api/system/persistence-status` → `storeFallbackActive: false`
3. `GET /api/system/staging-readiness` → `ola0PersistenceClosed: true`
4. `POST /api/jobs/run` → `persistence-audit` ok
5. Backup + restore probado (checklist §14)
6. `node scripts/validate-staging-readiness.mjs`
7. `RUN_DB_TESTS=true node scripts/validate-wisp-os-staging.mjs` (tablas)

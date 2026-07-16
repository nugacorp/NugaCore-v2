# FTTH Import — Exportar CSV/GeoJSON reales (staging)

Este runbook genera archivos listos para el importador FTTH:

- `naps.csv`
- `segments.csv`
- `ftth.geojson`

## Comando

```bash
BASE_URL="https://nugacore-staging.5.180.151.109.sslip.io" \
AUTH_BEARER="<jwt-authenticated>" \
npm run ftth:export-samples
```

Salida por defecto:

```text
artifacts/ftth-import/naps.csv
artifacts/ftth-import/segments.csv
artifacts/ftth-import/ftth.geojson
```

## Variables opcionales

- `OUTPUT_DIR` (default: `artifacts/ftth-import`)
- `ROLE_HEADER` (default: `super admin`)
- `USER_ID_HEADER` (default: `cloud-agent`)

> Nota: si staging exige JWT real, usa `AUTH_BEARER`.  
> En entornos que aceptan trusted headers, `x-user-role/x-user-id` se envían automáticamente.

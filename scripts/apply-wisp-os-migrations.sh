#!/usr/bin/env bash
# Aplica migraciones WISP OS (20260707*) cuando DATABASE_URL está disponible.
# Requiere: DATABASE_URL=postgresql://postgres.[ref]:[password]@...supabase.com:5432/postgres
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=(
  "$ROOT/supabase/migrations/20260707000000_crm_erp_wisp_schema.sql"
  "$ROOT/supabase/migrations/20260707100000_wisp_os_schema.sql"
  "$ROOT/supabase/migrations/20260707120000_ola6_radius_tenancy.sql"
  "$ROOT/supabase/migrations/20260708100000_portal_user_bindings.sql"
)

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL no configurado."
  echo "Obtener connection string en Supabase Dashboard → Project Settings → Database."
  echo "Alternativa: SUPABASE_ACCESS_TOKEN + supabase db push --linked"
  exit 1
fi

for file in "${MIGRATIONS[@]}"; do
  echo "Applying $(basename "$file")..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
done

psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema';"
echo "Migraciones WISP OS aplicadas. Refrescar schema cache PostgREST."

#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TEST_ROOT="$(mktemp -d /var/tmp/nugacore-gl02-harness.XXXXXX)"
KEY_FILE="/root/nugacore-gl02-harness-marker-$$.key"
[[ ! -e "$KEY_FILE" ]] || exit 9
trap 'case "$TEST_ROOT" in /var/tmp/nugacore-gl02-harness.*) rm -rf -- "$TEST_ROOT";; esac; case "$KEY_FILE" in /root/nugacore-gl02-harness-marker-*.key) rm -f -- "$KEY_FILE";; esac' EXIT
mkdir -p "$TEST_ROOT/bin"
LOG="$TEST_ROOT/argv.log"
ENV_FILE="$TEST_ROOT/production.env"
RCLONE_FILE="$TEST_ROOT/rclone.conf"
SOURCE_REF=abcdefghijklmnopqrst
TARGET_REF=qrstabcdefghijklmnop
CANARY_TOKEN=gl02_secret_canary_token
CANARY_DB=gl02_secret_canary_db

cat >"$KEY_FILE" <<'EOF'
0123456789abcdef0123456789abcdef0123456789abcdef
EOF
cat >"$ENV_FILE" <<EOF
PRODUCTION_DB_URL=postgresql://postgres:${CANARY_DB}@db.${SOURCE_REF}.supabase.co:5432/postgres
PRODUCTION_SUPABASE_URL=https://${SOURCE_REF}.supabase.co
SUPABASE_PROJECT_REF=${SOURCE_REF}
SUPABASE_ACCESS_TOKEN=${CANARY_TOKEN}
SUPABASE_STORAGE_S3_ENDPOINT=https://${SOURCE_REF}.storage.supabase.co/storage/v1/s3
SUPABASE_STORAGE_S3_ACCESS_KEY_ID=storage-canary
SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=storage-secret-canary
BACKUP_RCLONE_REMOTE=offsite-crypt
BACKUP_OFFSITE_CONFIRMED=true
BACKUP_OFFSITE_HOST=s3.backup.example.invalid
BACKUP_ON_HOST_IDENTITIES=vps.production.example.invalid,203.0.113.10
BACKUP_OFFSITE_BUCKET=nugacore-backups
BACKUP_NAMESPACE_ID=nugacore-production-0123456789abcdef
BACKUP_MARKER_HMAC_KEY_FILE=${KEY_FILE}
BACKUP_GPG_RECIPIENT=backup@example.invalid
BACKUP_RETENTION_DAYS=30
RESTORE_POSTGRES_IMAGE=supabase/postgres@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
RESTORE_TMPFS_SIZE=1g
RESTORE_REQUIRED_TABLES=clients,invoices
RESTORE_TARGET_CONFIRMED_ISOLATED=true
RESTORE_TARGET_PROJECT_REF=${TARGET_REF}
RESTORE_TARGET_DB_URL=postgresql://postgres:restore-secret@db.${TARGET_REF}.supabase.co:5432/postgres
RESTORE_TARGET_SUPABASE_URL=https://${TARGET_REF}.supabase.co
RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY=service-role-canary
RESTORE_TARGET_STORAGE_S3_ENDPOINT=https://${TARGET_REF}.storage.supabase.co/storage/v1/s3
RESTORE_TARGET_STORAGE_S3_ACCESS_KEY_ID=target-access-canary
RESTORE_TARGET_STORAGE_S3_SECRET_ACCESS_KEY=target-secret-canary
EOF
cat >"$RCLONE_FILE" <<'EOF'
[offsite]
type = s3
provider = Other
endpoint = https://s3.backup.example.invalid
[offsite-crypt]
type = crypt
remote = offsite:nugacore-backups/nugacore-production-0123456789abcdef
password = obscured
EOF
chmod 600 "$ENV_FILE" "$RCLONE_FILE" "$KEY_FILE"

export GL02_TEST_MODE=1 GL02_PRODUCTION_ENV="$ENV_FILE" GL02_RCLONE_CONFIG="$RCLONE_FILE"
export GL02_STUB_LOG="$LOG" GL02_SOURCE_REF="$SOURCE_REF"
node "$ROOT/scripts/gl02-marker.mjs" ownership >"$TEST_ROOT/ownership.json"
export GL02_STUB_OWNERSHIP="$TEST_ROOT/ownership.json"

cat >"$TEST_ROOT/bin/stub" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
name="$(basename "$0")"
printf '%s' "$name" >>"$GL02_STUB_LOG"
printf ' <%s>' "$@" >>"$GL02_STUB_LOG"
printf '\n' >>"$GL02_STUB_LOG"
case "$name" in
  rclone)
    if [[ "${1:-}" == cat && "${2:-}" == *OWNERSHIP.json ]]; then cat "$GL02_STUB_OWNERSHIP"; exit 0; fi
    if [[ "${1:-}" == lsf && "${2:-}" == supabase_storage: ]]; then printf 'bucket/object\n'; exit 0; fi
    if [[ "${1:-}" == copy && "${2:-}" == /var/tmp/nugacore-gl02-backup.* ]]; then printf '%s' "$2" >"${GL02_STUB_LOG}.work"; exit 0; fi
    if [[ "${1:-}" == cat && "${2:-}" == *manifest.json ]]; then cat "$(cat "${GL02_STUB_LOG}.work")/manifest.json"; exit 0; fi
    if [[ "${1:-}" == lsf && "${2:-}" == offsite-crypt: && "${GL02_FAIL_RETENTION:-0}" == 1 ]]; then exit 44; fi
    exit 0
    ;;
  curl)
    config="${2:-}"
    output="$(sed -n 's/^output = "\(.*\)"$/\1/p' "$config")"
    if grep -q '/database/backups' "$config"; then
      printf '{"backups":[{}]}\n' >"$output"
    else
      printf '{"id":"%s"}\n' "$GL02_SOURCE_REF" >"$output"
    fi
    ;;
  pg_dump|pg_dumpall)
    for arg in "$@"; do case "$arg" in --file=*) printf '%s\n' "$name-data" >"${arg#--file=}";; esac; done
    ;;
  docker)
    [[ "${1:-}" == exec && "${2:-}" == coolify-db ]] && printf 'coolify-data\n'
    ;;
  tar)
    if [[ " $* " == *" -czf "* ]]; then
      index=1; for arg in "$@"; do if [[ "$arg" == -czf ]]; then eval "out=\${$((index+1))}"; printf 'infra-data\n' >"$out"; break; fi; index=$((index+1)); done
    fi
    ;;
  gpg)
    out=''; previous=''; for arg in "$@"; do [[ "$previous" == --output ]] && out="$arg"; previous="$arg"; done
    cp "${@: -1}" "$out"
    ;;
esac
STUB
chmod 700 "$TEST_ROOT/bin/stub"
for name in rclone curl pg_dump pg_dumpall docker tar gpg; do ln -s stub "$TEST_ROOT/bin/$name"; done
export PATH="$TEST_ROOT/bin:$PATH"

# Parser must reject shell syntax before any external command runs.
cp "$ENV_FILE" "$TEST_ROOT/bad.env"
# The literal substitution below is the attack fixture.
# shellcheck disable=SC2016
printf 'SUPABASE_ACCESS_TOKEN=$(touch /tmp/gl02-harness-pwned)\n' >>"$TEST_ROOT/bad.env"
chmod 600 "$TEST_ROOT/bad.env"
: >"$LOG"
if GL02_PRODUCTION_ENV="$TEST_ROOT/bad.env" node "$ROOT/scripts/validate-gl02-backup-config.mjs" production-backup >/dev/null 2>&1; then exit 10; fi
[[ ! -e /tmp/gl02-harness-pwned && ! -s "$LOG" ]]

# Loopback backings fail before rclone can be touched.
sed 's#https://s3.backup.example.invalid#http://127.0.0.1:9000#' "$RCLONE_FILE" >"$TEST_ROOT/loopback.conf"
chmod 600 "$TEST_ROOT/loopback.conf"
if GL02_RCLONE_CONFIG="$TEST_ROOT/loopback.conf" node "$ROOT/scripts/validate-gl02-backup-config.mjs" production-backup >/dev/null 2>&1; then exit 11; fi

# Authenticated ownership permits dry-run, but does not write COMPLETE or purge.
: >"$LOG"
node "$ROOT/scripts/vps/gl02-backup.mjs" --dry-run | grep -q '"status":"dry-run-ready"'
if grep -Eq 'copyto|purge' "$LOG"; then exit 14; fi

# An explicit retention listing failure makes the whole run fail; purge is never attempted.
: >"$LOG"
if GL02_FAIL_RETENTION=1 node "$ROOT/scripts/vps/gl02-backup.mjs" --execute >"$TEST_ROOT/backup.out" 2>&1; then exit 12; fi
grep -q '"status":"blocked"' "$TEST_ROOT/backup.out"
if grep -q '^rclone <purge>' "$LOG"; then exit 15; fi

# Credentials are passed through protected files/env, never command argv.
if grep -Fq "$CANARY_TOKEN" "$LOG"; then exit 16; fi
if grep -Fq "$CANARY_DB" "$LOG"; then exit 17; fi

# A missing/tampered COMPLETE marker blocks restore before Docker/destructive work.
: >"$LOG"
if node "$ROOT/scripts/vps/gl02-restore-drill.mjs" --dry-run --backup-id 20260809T220000Z >"$TEST_ROOT/restore.out" 2>&1; then exit 13; fi
if grep -q '^docker ' "$LOG"; then exit 18; fi

bash -n "$ROOT/scripts/vps/gl02-backup.sh" "$ROOT/scripts/vps/gl02-restore-drill.sh" "$ROOT/tests/ops/gl02-linux-harness.sh"
shellcheck "$ROOT/scripts/vps/gl02-backup.sh" "$ROOT/scripts/vps/gl02-restore-drill.sh" "$ROOT/tests/ops/gl02-linux-harness.sh"
sed -e 's#^WorkingDirectory=.*#WorkingDirectory=/#' \
  -e 's#^ExecStart=.*#ExecStart=/bin/true#' \
  "$ROOT/deployment/systemd/nugacore-gl02-backup.service" >"$TEST_ROOT/nugacore-gl02-backup.service"
cp "$ROOT/deployment/systemd/nugacore-gl02-backup.timer" "$TEST_ROOT/nugacore-gl02-backup.timer"
systemd-analyze verify "$TEST_ROOT/nugacore-gl02-backup.service" "$TEST_ROOT/nugacore-gl02-backup.timer"
printf '{"scope":"gl02-linux-harness","status":"verified","negativeTests":5,"secretsInArgv":false}\n'

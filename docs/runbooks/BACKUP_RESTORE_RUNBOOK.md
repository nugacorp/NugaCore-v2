# NugaCore — Backup, restore y rollback (GL-02)

**Alcance:** Supabase Database y Storage, Coolify, WireGuard y configuración
operativa del VPS. Los secretos nunca se imprimen ni se guardan en el repo.

**Gate:** `PRODUCTION_RESTORE_TESTED=true` sólo después de un restore real en un
proyecto Supabase aislado, con DB/Storage, roles, Coolify, control plane y
RouterOS LAB verificados en evidencia JSON. El flag sin evidencia válida no
habilita el gate.

## 1. Objetivos y responsables

| Objetivo | Valor inicial |
|---|---:|
| RPO | 24 horas |
| RTO máximo | 8 horas |
| RTO operativo objetivo | 4 horas |
| Backup lógico + Storage off-site | Diario |
| Retención off-site | 30 días |

- **Propietario de producción:** aprueba destino, credenciales, restore target,
  rollback y cualquier cambio de gate.
- **Operador de guardia:** comprueba timer, backup administrado, copia off-site,
  checksums y evidencia sanitizada.
- **Revisor:** reproduce el restore aislado y confirma que el target no es
  production antes de aceptar el gate.

## 2. Por qué Database y Storage son dos backups

Los backups administrados de Supabase cubren PostgreSQL, pero no los bytes de
Storage; sólo preservan metadata de `storage.objects`. Un restore de DB no
recupera un archivo borrado. Por eso GL-02 exige:

1. backup administrado de Supabase disponible;
2. dump lógico cifrado independiente;
3. copia completa de Storage a un `rclone crypt` off-host;
4. configuración Coolify/WireGuard cifrada en el mismo destino externo.

Referencias oficiales:

- <https://supabase.com/docs/guides/platform/backups>
- <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- <https://supabase.com/docs/guides/platform/clone-project>

## 3. Scaffolding root-only del VPS

Archivos que deben ser `root:root` y modo `0600`:

```text
/root/nugacore-production-backup.env
/root/.config/rclone/rclone.conf
/root/nugacore-routeros-lab.env
```

Los placeholders permanecen vacíos hasta provisionarse por un canal aprobado.
El validador informa sólo nombres faltantes, nunca valores:

```bash
node scripts/validate-gl02-backup-config.mjs production-backup
node scripts/validate-gl02-backup-config.mjs production-restore
node scripts/validate-gl02-backup-config.mjs routeros-lab
```

El dotenv se parsea como datos: no se usa `source`, y se rechazan claves
desconocidas/duplicadas, `export`, sustituciones y separadores de shell.
DB/API/Storage deben derivar del mismo project ref canónico tanto en source como
en target; aliases y cambios de casing no crean una identidad distinta.

`BACKUP_RCLONE_REMOTE` debe ser `crypt` sobre el bucket y namespace exactos de
la allowlist. Se rechazan HTTP, loopback, RFC1918/link-local, identidades del VPS,
un remote sin cifrado y resolución DNS hacia el propio host. El namespace lleva
`OWNERSHIP.json` autenticado por HMAC; sin ese marker ningún backup, restore o
purge puede empezar. La llave HMAC también es root-only bajo `/root`.

Provisionamiento único del marker, sólo tras verificar el destino externo:

```bash
sudo node scripts/gl02-marker.mjs ownership > /var/tmp/OWNERSHIP.json
sudo rclone copyto /var/tmp/OWNERSHIP.json "REMOTE_CRYPT:OWNERSHIP.json" --immutable
sudo rm -f /var/tmp/OWNERSHIP.json
```

`RESTORE_POSTGRES_IMAGE` requiere digest `@sha256:`; no se aceptan `latest` ni
tags sin digest.

## 4. Backup diario y retención

Preflight sin escribir datos:

```bash
sudo scripts/vps/gl02-backup.sh --dry-run
```

El modo `--execute` realiza, en este orden:

1. atestigua por Management API el project ref y que exista al menos un backup
   administrado del mismo proyecto usado por DB/API/Storage;
2. genera `pg_dump` y roles en un directorio temporal root-only, los cifra y
   elimina inmediatamente los planos;
3. respalda la DB interna de Coolify;
4. cifra `/etc/wireguard` y el control plane de Coolify;
5. copia Storage directamente desde el endpoint S3 de Supabase al remote
   cifrado, sin usar el disco local como destino;
6. verifica control plane con `rclone cryptcheck`, Storage mediante descarga y
   vuelve a descargar el manifest para verificarlo;
7. escribe `COMPLETE.json` autenticado sólo después de verificar DB, roles,
   Coolify, infraestructura, Storage y manifest;
8. lista retención con status explícito y elimina únicamente IDs UTC expirados
   cuyo `COMPLETE.json` tenga HMAC, namespace y backup ID válidos. Un fallo de
   listado/marker bloquea la ejecución sin purgar.

Activar el timer únicamente después de que el dry-run pase y exista un backup
manual verificado:

```bash
sudo install -o root -g root -m 0644 \
  deployment/systemd/nugacore-gl02-backup.service \
  deployment/systemd/nugacore-gl02-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nugacore-gl02-backup.timer
sudo systemctl list-timers nugacore-gl02-backup.timer
```

La alerta externa por fallo pertenece al wiring de observabilidad de GL-07. Un
timer sin destino de alertas no debe describirse como “monitoreado”.

## 5. Restore completo aislado

El preflight valida ownership, COMPLETE y el ID UTC sin escribir. En execute,
el target Supabase debe ser distinto y coherente en DB/API/Storage. Los drills
de roles y Coolify nunca publican puertos: usan `--network none`, tmpfs limitado
y `--env-file`. Infraestructura se extrae en un directorio temporal dedicado.

```bash
sudo scripts/vps/gl02-restore-drill.sh \
  --backup-id YYYYMMDDTHHMMSSZ --dry-run

# Sólo tras revisar target e imagen fijada por digest:
sudo scripts/vps/gl02-restore-drill.sh \
  --backup-id YYYYMMDDTHHMMSSZ --execute \
  --routeros-evidence /ruta/root-only/routeros-lab-evidence.json \
  --evidence-out /var/lib/nugacore/gl02/production-restore-evidence.json
```

El script consume y verifica marker+manifest, restaura DB en el target aislado,
copia Storage al S3 de ese target, prueba roles/Coolify en contenedores aislados,
valida infraestructura y exige evidencia RouterOS firmada con `environment=LAB`.
Cualquier componente faltante termina BLOCKED: nunca existe PASS parcial. No
toca production ni cambia flags.

## 6. Evidencia y gate

El archivo JSON contiene hashes de los project refs, no sus valores; backup ID,
RPO/RTO y booleanos obligatorios para marker, manifest, DB, Storage, roles,
Coolify, control plane y rollback RouterOS LAB. El validador falla si falta el
archivo, cualquier campo o el flag productivo. `STAGING_RESTORE_TESTED` nunca
satisface readiness de producción.

Sólo tras un execute real completamente verificado:

```bash
PRODUCTION_RESTORE_TESTED=true \
PRODUCTION_RESTORE_EVIDENCE_FILE=/var/lib/nugacore/gl02/production-restore-evidence.json \
PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE=/root/nugacore-backup-marker.key \
node scripts/validate-restore-checklist.mjs
```

El target temporal se destruye conforme a la política aprobada sólo después de
conservar evidencia; esa eliminación requiere aprobación explícita.

## 7. Rollback de deploy y migración

### Deploy sin cambio de schema

1. Mantener la imagen/commit previo identificable.
2. Revertir el deployment en Coolify a esa imagen.
3. Ejecutar health, readiness y smoke productivo sanitizado.
4. Si el smoke falla, volver al estado previo y escalar; no improvisar cambios
   de DB.

### Migración compatible hacia adelante

1. Tomar y verificar backup antes de migrar.
2. Aplicar migración primero en el restore target y staging.
3. Desplegar código compatible con schema anterior y nuevo.
4. Ante fallo, volver el código; conservar columnas/tablas aditivas hasta una
   ventana posterior.

### Migración destructiva o incompatible

No ejecutar hasta disponer de backup+restore real y aprobación. Un restore
in-place de production implica downtime y pérdida desde el recovery point; se
reserva para desastre confirmado, no para pruebas. El camino preferido es
blue/green: restaurar en target nuevo, validar y cambiar tráfico explícitamente.

## 8. RouterOS sólo en laboratorio

`/root/nugacore-routeros-lab.env` requiere `ROUTEROS_LAB_CONFIRMED=true` y una
identidad esperada. Sin ambas, ningún script debe conectar.

Para preparar CHR:

1. obtener la imagen únicamente del sitio oficial de MikroTik;
2. verificar checksum publicado antes de importar;
3. respetar licencia; no asumir que una imagen descargada está autorizada;
4. usar red Docker/hipervisor aislada sin rutas a clientes, WireGuard production
   ni subredes de gestión reales;
5. fijar una identidad inequívoca, por ejemplo `chr-gl02-lab`;
6. exportar configuración sin secretos y tomar backup binario protegido;
7. aplicar un cambio reversible mínimo, restaurar y comprobar identidad/estado;
8. conservar sólo evidencia sanitizada y eliminar secretos temporales.

No se descarga una imagen ni se conecta un router como parte del scaffolding.

## 9. Evidencia mínima

- backup ID y hora UTC;
- backup administrado disponible (sí/no, sin project ref);
- checksum y `rclone check` PASS;
- conteos DB/Storage, nunca contenidos;
- duración observada y cumplimiento RPO/RTO;
- restore target distinto confirmado;
- smoke por dominio;
- rollback LAB RouterOS PASS;
- resultado del validador y gate final.

Hasta completar todos estos puntos, `PRODUCTION_RESTORE_TESTED` permanece en
`false` y GL-02 continúa en progreso.

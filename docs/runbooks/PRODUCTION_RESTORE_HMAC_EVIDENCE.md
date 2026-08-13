# Production Restore HMAC Evidence

Este runbook describe como generar, firmar y validar evidencia real de restore
para el gate `validate-restore-checklist:strict`.

No fabricar evidencia. No copiar evidencia de staging. No imprimir la llave HMAC.

## Alcance

El gate productivo requiere demostrar que un backup real de produccion puede
restaurarse en un ambiente aislado y verificable. La evidencia debe probar:

- Backup generado desde el ambiente productivo correcto.
- Restore ejecutado en un target aislado y distinto.
- Integridad de manifiesto y marcador `COMPLETE`.
- Base, storage, roles, Coolify/control-plane y rollback de RouterOS lab
  verificados.
- RPO/RTO dentro del umbral aprobado.
- Firma HMAC valida con una llave root-only.

## Variables Del Gate

```bash
PRODUCTION_RESTORE_TESTED=true
PRODUCTION_RESTORE_EVIDENCE_FILE=/var/lib/nugacore/gl02/production-restore-evidence.json
PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE=/root/nugacore-backup-marker.key
```

La llave HMAC debe estar fuera del repo, con permisos `0600` y ownership root en
Linux. El validador strict rechaza llaves con metadata insegura.

## Flujo Seguro

1. Preparar el host operativo aprobado.

   - Cargar secretos desde gestor seguro.
   - Confirmar que no se imprimen variables completas.
   - Confirmar que el target de restore no apunta a produccion.
   - Confirmar que el target tiene namespace/proyecto distinto.

2. Generar backup real.

   ```bash
   sudo node scripts/vps/gl02-backup.mjs
   ```

   Antes de ejecucion real, correr el dry-run que corresponda al runbook GL-02.
   El backup debe producir manifiesto, marcador `COMPLETE` y copia off-host
   cifrada. No subir dumps ni manifests con secretos al repo.

3. Restaurar en ambiente aislado.

   ```bash
   sudo node scripts/vps/gl02-restore-drill.mjs --backup-id YYYYMMDDTHHMMSSZ
   ```

   El target debe ser desechable o explicitamente aislado. Nunca restaurar sobre
   la base productiva ni sobre staging compartido.

4. Validar integridad.

   Confirmar como minimo:

   - Manifest verificado.
   - Marker `COMPLETE` autenticado.
   - `sourceProjectRefHash` y `targetProjectRefHash` existen y son distintos.
   - `sourceTargetDistinct=true`.
   - `databaseRestored=true`.
   - `storageRestored=true`.
   - `rolesVerified=true`.
   - `coolifyVerified=true`.
   - `controlPlaneVerified=true`.
   - `routerOsLabRollbackVerified=true`.

5. Generar evidencia JSON.

   La evidencia debe tener `kind=RESTORE_EVIDENCE`, `status=verified`,
   `backupId`, hashes de source/target y los campos booleanos anteriores.
   No incluir URLs completas, passwords, JWT, service-role keys ni dumps.

6. Firmar con HMAC.

   La firma se calcula sobre la forma canonica del JSON sin el campo `hmac`, con
   la llave root-only. Usar las utilidades del repo; no imprimir la llave.

7. Validar strict.

   ```bash
   npm run validate-restore-checklist:strict
   npm run validate-production-readiness:strict
   ```

   Si falta evidencia real, el resultado correcto es `BLOCKED`/exit 1. Ese fallo
   no debe arreglarse relajando validadores.

## Rechazos Obligatorios

La evidencia debe rechazarse si:

- `PRODUCTION_RESTORE_TESTED` no es `true`.
- Falta archivo de evidencia o llave HMAC.
- La firma HMAC no coincide.
- La llave no es root-only/0600 en Linux.
- Source y target no son distintos.
- El backup no pertenece al ambiente esperado.
- El restore es viejo segun la politica aprobada.
- El JSON contiene secretos o URLs sensibles completas.
- Se uso staging como sustituto de produccion.

## Estado Local Esperado

En desarrollo local:

```bash
npm run validate-restore-checklist
```

puede salir 0 con `EXTERNAL_BLOCKED`. Esto solo confirma que no se fabrico
evidencia. El gate strict debe seguir fallando hasta que exista evidencia real:

```bash
npm run validate-restore-checklist:strict
```

## Registro De Aprobacion

Al cerrar una validacion real, registrar en un reporte sanitizado:

- Ambiente.
- Fecha/hora UTC.
- Backup ID.
- Hashes parciales o fingerprints no reversibles.
- Resultado de restore.
- Resultado de validadores strict.
- Responsable que aprobo ejecutar el drill.
- Confirmacion de que no se imprimieron ni commitearon secretos.

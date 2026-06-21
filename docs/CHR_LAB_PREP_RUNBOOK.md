# CHR Lab Prep Runbook (FAST-1, Parte C)

> Runbook **documental** para preparar un MikroTik CHR (Cloud Hosted Router) de
> laboratorio antes de cualquier prueba de conectividad RouterOS.
>
> **Esta fase NO implementa conexión real.** Es preparación. No se toca ningún
> router de producción ni cliente. No se activa worker live ni commit mode.
> Fecha: 2026-06-21.

## 0. Principios

- **Solo laboratorio.** Nunca usar routers reales ni de clientes para estas pruebas.
- **Read-only primero.** El primer contacto con el CHR es de lectura (ver
  `docs/ROUTEROS_READ_ONLY_API_PLAN.md`). Sin escrituras.
- **Aislamiento.** El CHR de lab vive en una red/segmento separado de producción.
- **Sin secretos en repo/logs.** Credenciales de lab por variable de entorno o gestor
  de secretos; nunca en commits, issues ni documentación.
- **Reversibilidad.** Backup/export antes de cualquier prueba; rollback documentado.

## 1. Qué es un CHR

MikroTik CHR es una imagen de RouterOS para virtualización (sirve como router de
pruebas sin hardware). Permite validar la API y los flujos read-only de NugaCore en un
entorno desechable y aislado, antes de tocar cualquier equipo real.

## 2. Provisión del CHR de laboratorio

1. Desplegar una VM con la imagen CHR de RouterOS (versión alineada a la flota:
   documentar v6 vs v7) en un hipervisor/nube de laboratorio aislado.
2. Asignar el CHR a una red de management separada (sin ruta a producción/clientes).
3. Aplicar licencia CHR apropiada para lab (p1/free según límites de prueba).
4. Registrar metadatos del lab (no sensibles): versión RouterOS, arquitectura, fecha.

## 3. Hardening mínimo del CHR de lab

- Cambiar credenciales por defecto; crear un usuario dedicado de lab con permisos
  acotados (idealmente de solo lectura para la primera fase).
- Habilitar la API solo en la interfaz de management.
- **Preferir API-SSL (TLS, puerto `8729`)**; si el lab usa `8728` (texto plano),
  documentarlo explícitamente como excepción de laboratorio.
- Firewall del CHR: permitir API solo desde la IP/host de NugaCore lab.
- Deshabilitar servicios no usados (telnet, ftp, www sin TLS).

## 4. Conexión (management / WireGuard) — preparación

- Definir el canal de management: WireGuard punto a punto o IP de management directa
  dentro del segmento de lab.
- Si se usa WireGuard: generar par de claves de **laboratorio** (no reutilizar las de
  producción), documentar el peer del lab, mantener claves privadas fuera del repo.
- Verificar alcance L3 (ping/management) **antes** de intentar la API.
- Anotar IP de management, puerto API y modo (SSL/no-SSL) en la config de lab (sin
  exponer credenciales).

## 5. Backup / export antes de pruebas

Obligatorio antes de cualquier prueba (incluso read-only), para poder restaurar:

- `/system backup save` → backup binario completo del CHR.
- `/export file=` → export de configuración legible (revisar que no se loguee/commitee
  con secretos).
- Guardar ambos artefactos fuera del CHR, en almacenamiento de lab cifrado.
- Registrar hash/fecha del backup.

## 6. Credenciales de prueba

- Usuario dedicado de lab, distinto de cualquier credencial productiva.
- Credenciales por variable de entorno / gestor de secretos del entorno de lab.
- Rotación tras finalizar la campaña de pruebas.
- Nunca en commits, capturas, issues ni en este documento.

## 7. Orden de pruebas (estricto)

1. **Read-only** primero: identidad, recursos, interfaces, direcciones, rutas
   (ver `docs/ROUTEROS_READ_ONLY_API_PLAN.md`). Sin escrituras.
2. Dry-run de escrituras (sin commit) — **fase futura**, fuera de este runbook.
3. Escrituras controladas en lab — **fase futura**, con backup + rollback.

No avanzar de nivel sin cerrar el anterior y documentar resultado.

## 8. Rollback

- Si una prueba deja el CHR en estado inesperado: restaurar desde
  `/system backup load` (backup del paso 5) o redeplegar la VM del CHR desde cero.
- El CHR es desechable: ante cualquier duda, recrear la VM en vez de "arreglar".
- Documentar qué se restauró y por qué.

## 9. Qué NO hacer

- ❌ No usar routers reales ni de clientes.
- ❌ No conectar el CHR de lab a la red de producción.
- ❌ No activar `MIKROTIK_WORKER_LIVE`, commit mode, `USE_DB_MIKROTIK`,
  `MIKROTIK_WRITE_ENABLED` en este runbook.
- ❌ No realizar escrituras en la primera fase.
- ❌ No commitear backups/exports con secretos ni claves privadas.

## 10. Checklist de preparación (lab)

- [ ] CHR desplegado en segmento aislado de lab.
- [ ] Versión RouterOS documentada (v6/v7).
- [ ] Credenciales por defecto cambiadas; usuario de lab acotado creado.
- [ ] API habilitada solo en management; SSL preferido (8729) o excepción documentada.
- [ ] Firewall del CHR restringe API al host de NugaCore lab.
- [ ] Canal de management/WireGuard de lab verificado (ping OK).
- [ ] Backup binario + export realizados y guardados cifrados fuera del CHR.
- [ ] Credenciales de lab fuera del repo.
- [ ] Plan read-only revisado (`docs/ROUTEROS_READ_ONLY_API_PLAN.md`).
- [ ] Rollback (restore/redeploy) verificado.

## 11. Siguiente fase

Tras completar este checklist en lab, la siguiente fase es la **lectura read-only**
de RouterOS descrita en `docs/ROUTEROS_READ_ONLY_API_PLAN.md` (sin escrituras, sin
worker live). La conexión real recién se implementa en esa fase, contra el CHR de lab.

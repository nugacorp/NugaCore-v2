# CHR MikroTik Lab Readiness Workflow

Este runbook prepara una prueba real contra MikroTik CHR o router fisico no
productivo. No autoriza uso contra routers de clientes ni produccion.

## Principios

- Dry-run por defecto.
- Read-only antes de cualquier escritura.
- Real-run solo con aprobacion manual y variables explicitas.
- No guardar credenciales en el repo.
- No imprimir passwords, exports completos, JWT ni secrets.
- Cleanup obligatorio de objetos QA.
- Si el cleanup falla, detener la fase y restaurar backup/snapshot del CHR.

## Ambiente Requerido

- CHR/router no productivo.
- Backup/snapshot previo del CHR.
- Alcance de red por VPN/LAN.
- API RouterOS habilitada:
  - API plano 8728 solo en red cerrada de lab.
  - API-SSL 8729 preferido para pruebas controladas.
- Usuario read-only:
  - Politicas minimas: `read`, `api` o `rest-api` segun transporte usado.
- Usuario control QA:
  - Solo para el paso de escritura aprobado.
  - Password temporal.
  - Restriccion por IP de gestion cuando aplique.

## Variables De Lab

Usar un archivo local no commiteado o secrets del entorno:

```env
ROUTEROS_HOST=10.0.0.10
ROUTEROS_PORT=8729
ROUTEROS_USERNAME=nuga-ro
ROUTEROS_PASSWORD=__SECRET__
ROUTEROS_TLS_REJECT_UNAUTHORIZED=false
ROUTEROS_TIMEOUT_MS=4000

MIKROTIK_LAB_DRY_RUN=true
MIKROTIK_LAB_REAL_RUN=false
MIKROTIK_LAB_CONFIRMATION=
MIKROTIK_LAB_QA_PREFIX=NC-QA-
```

Para escritura controlada usar credenciales separadas:

```env
ROUTEROS_CONTROL_USERNAME=nuga-qa-control
ROUTEROS_CONTROL_PASSWORD=__SECRET__
```

`MIKROTIK_WORKER_LIVE` y `MIKROTIK_WORKER_COMMIT` deben seguir `false` salvo una
aprobacion separada para el worker de la aplicacion. Este runbook valida el lab,
no habilita produccion.

## Paso 1: Backup/Snapshot

En el CHR:

```routeros
/system backup save name=pre-nugacore-qa
/export file=pre-nugacore-qa-export
```

No commitear ni pegar exports completos en tickets o docs. Revisar que no
contengan secretos antes de compartir cualquier fragmento.

## Paso 2: Lecturas Read-Only

Validar primero con el usuario read-only. Comandos requeridos:

```routeros
/system/resource/print
/system/identity/print
/interface/print
/queue/simple/print
/ip/dhcp-server/lease/print
/ip/arp/print
/ip/firewall/address-list/print
```

Si alguna lectura falla por permisos o timeout, no avanzar a escritura. Ajustar
firewall, API service o permisos del usuario read-only y repetir.

## Paso 3: Dry-Run De Escrituras QA

Antes de tocar el router, generar el plan exacto y revisarlo:

```text
CREATE_QUEUE:
  /queue/simple/add name="NC-QA-client-001" target="192.0.2.10/32" max-limit="1M/1M" comment="NC-QA cleanup required"

SUSPEND_QA:
  /ip/firewall/address-list/add list="NC-QA-SUSPENDED" address="192.0.2.10" comment="NC-QA-client-001"
  /queue/simple/disable [find where name="NC-QA-client-001"]

REACTIVATE_QA:
  /ip/firewall/address-list/remove [find where list="NC-QA-SUSPENDED" and comment="NC-QA-client-001"]
  /queue/simple/enable [find where name="NC-QA-client-001"]

CLEANUP_QA:
  /queue/simple/remove [find where name="NC-QA-client-001"]
  /ip/firewall/address-list/remove [find where list="NC-QA-SUSPENDED" and comment="NC-QA-client-001"]
```

El dry-run debe registrar:

- Router target.
- Usuario usado, sin password.
- Comandos planeados.
- Objetos QA con prefijo `NC-QA-`.
- Resultado esperado.
- Plan de cleanup.

## Paso 4: Real-Run Controlado

Solo ejecutar si se cumplen todas las condiciones:

- Aprobacion manual explicita.
- CHR/router no productivo confirmado.
- Backup/snapshot previo confirmado.
- Read-only PASS.
- Dry-run revisado.
- `MIKROTIK_LAB_REAL_RUN=true`.
- `MIKROTIK_LAB_CONFIRMATION=CHR_NON_PRODUCTION_QA_APPROVED`.
- Prefijo QA configurado y no vacio.

Orden obligatorio:

1. Crear simple queue QA.
2. Leer `/queue/simple/print` y confirmar que solo existe el objeto QA.
3. Suspender cliente QA con address-list/queue.
4. Leer queue/address-list y confirmar estado.
5. Reactivar cliente QA.
6. Leer queue/address-list y confirmar estado.
7. Ejecutar cleanup QA.
8. Leer queue/address-list y confirmar cero objetos `NC-QA-`.

## Auditoria Esperada

Registrar un reporte sanitizado:

- Fecha/hora UTC.
- Host o alias del CHR, sin password.
- Transporte usado: API 8728 o API-SSL 8729.
- Usuario read-only y usuario control, sin secretos.
- Resultado de cada lectura.
- Resultado de create/suspend/reactivate/cleanup.
- Confirmacion de cleanup.
- Confirmacion de que `MIKROTIK_WORKER_COMMIT` no se habilito.

## Criterios De Bloqueo

Detenerse si:

- El router es productivo o hay duda.
- No existe backup/snapshot previo.
- La lectura read-only falla.
- El usuario control tiene permisos excesivos no aprobados.
- El plan toca objetos sin prefijo QA.
- Falta cleanup o cleanup falla.
- Aparecen secretos en logs.
- `MIKROTIK_WORKER_LIVE` o `MIKROTIK_WORKER_COMMIT` se activan por accidente.

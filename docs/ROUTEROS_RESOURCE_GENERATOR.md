# RouterOS Resource Generator — NugaCore

## Objetivo

Permite a los operadores WISP generar scripts `.rsc` completos y seguros para configurar routers
MikroTik desde cero. Cada script deja el router listo para conectarse a NugaCore vía WireGuard o
SSTP y exponer la API solo dentro del túnel VPN.

**No ejecuta comandos en routers reales.** Solo genera texto `.rsc` para importar manualmente.

---

## Arquitectura

### Backend

```
backend/domains/routeros-resources/
  types.ts        — interfaces y constantes
  templates.ts    — catálogo de plantillas disponibles
  generator.ts    — construcción del script sección por sección
  validators.ts   — validación de parámetros de entrada
  safe-rsc.ts     — redacción de secretos, filename, assertions de seguridad
  routes.ts       — endpoints REST + cache temporal de scripts
```

### Frontend

```
src/components/RouterOsResourcesModule.tsx   — UI con 4 tabs
src/lib/routerosResourcesRbac.ts             — helpers RBAC de UI
```

### Tests

```
tests/unit/routeros.generator.test.ts        — generador, validators, safe-rsc, templates
tests/contract/routeros.resources.contract.test.ts — endpoints + RBAC
```

---

## Plantillas disponibles

| ID                    | Nombre                                  | Categoría   | ROS min |
|-----------------------|-----------------------------------------|-------------|---------|
| base_wisp_wireguard   | Router Base WISP + WireGuard NugaCore   | Producción  | v7      |
| base_wisp_sstp        | Router Base WISP + SSTP NugaCore        | Producción  | v6      |
| lab_direct            | Laboratorio — Acceso Directo            | Laboratorio | any     |

---

## Ejemplo de script saneado (base_wisp_wireguard)

```
# ============================================================
# NugaCore — Resource Generator Script
# Plantilla: Router Base WISP + WireGuard NugaCore
# Router: MI-WISP-ROUTER
# Generado: 2026-06-11 23:18:30 UTC
# Version: nugacore-rscgen-1.0
# RouterOS: v7+
# ============================================================
# ADVERTENCIA: Haz un backup antes de importar este script.
#   /system backup save name=backup-pre-nugacore
# Importar con:
#   /import file-name=nugacore-base-wisp-wireguard-MI-WISP-ROUTER-2026-06-11.rsc
# ============================================================

# --- 1. Limpieza idempotente de configuracion NugaCore previa ---
/user remove [find where name~"nugacore_"]
/user group remove [find where name~"nugacore"]
/ip route remove [find where comment~"NugaCore"]
...

# --- 2. Identidad del router ---
/system identity set name="MI-WISP-ROUTER"

# --- 3. Bridge LAN y puertos ---
/interface bridge
:if ([:len [find name="bridgeLAN"]] = 0) do={
  add name="bridgeLAN" fast-forward=no comment="NugaCore LAN bridge"
}
...

# --- 12. Grupo NugaCore con permisos minimos ---
/user group
:if ([:len [find name="nugacore"]] = 0) do={
  add name="nugacore" policy="read,write,api,test" comment="NugaCore minimal API group"
}

# --- 13. Usuario API NugaCore ---
# El password se muestra aqui UNA SOLA VEZ. Guarda este script ahora.
/user add name="nugacore_ab12cd34" password="••••••••" group="nugacore" comment="NugaCore API user"

# --- 15. WireGuard (RouterOS v7) ---
/interface wireguard
:if ([:len [find name="NugaCoreWG"]] = 0) do={
  add name="NugaCoreWG" listen-port=13231 comment="NugaCore WireGuard"
}
...
```

---

## Cómo descargar e importar el .rsc

### Desde NugaCore

1. Ve a **Recursos MikroTik** → **Configurar**
2. Completa los parámetros de tu red y del servidor NugaCore
3. Click en **Generar Script .rsc**
4. Click en **Descargar** o **Copiar script**

### En el router MikroTik

**Opción A — Importar archivo** (recomendado):
```
# Copiar el archivo al router (vía Winbox: Files > drag & drop)
/import file-name=nugacore-base-wisp-wireguard-MI-ROUTER-2026-06-11.rsc
```

**Opción B — Terminal**:
```
# Pegar el script directamente en el terminal de Winbox o SSH
```

### Tras importar

1. Verificar que la interfaz WireGuard se creó:
   ```
   /interface wireguard print where name=NugaCoreWG
   ```
2. Copiar el campo `public-key` del router
3. Registrar esa public-key en NugaCore para completar el túnel

---

## Seguridad

### Secretos — una sola vez

El script generado contiene el password del usuario API NugaCore y (para SSTP) el password VPN.
Estos secretos se muestran **una sola vez** al generar.

**NugaCore solo persiste:**
- Hash SHA256 del script
- Metadatos: templateId, routerName, filename, fecha, usuario que generó

**NugaCore NUNCA persiste:**
- El script completo
- Passwords en texto claro
- Private keys

El link de descarga expira en **1 hora** tras la generación.

### Permisos del usuario API

```
policy="read,write,api,test"
```

Explícitamente excluidos: `sniff`, `sensitive`, `romon`, `reboot`, `password`, `policy`, `ftp`

### API limitada al CIDR VPN

El servicio API del router solo responde desde la red de gestión de NugaCore (dentro del túnel
WireGuard o SSTP). No queda expuesto al WAN.

---

## RBAC

| Acción             | Super Admin | Administrador | Técnico | Cobranza | Soporte | Solo lectura |
|--------------------|-------------|---------------|---------|----------|---------|--------------|
| Ver plantillas     | ✅          | ✅            | ✅      | ❌       | ❌      | ✅           |
| Generar script     | ✅          | ✅            | ✅      | ❌       | ❌      | ❌           |
| Descargar .rsc     | ✅          | ✅            | ✅      | ❌       | ❌      | ❌           |
| Ver historial      | ✅          | ✅            | ❌      | ❌       | ❌      | ❌           |

---

## Endpoints

```
GET  /api/routeros-resources/templates          — catálogo de plantillas
POST /api/routeros-resources/generate           — genera script + credenciales
GET  /api/routeros-resources/download/:hash     — descarga .rsc (TTL 1h)
GET  /api/routeros-resources/history            — historial de generaciones (metadata)
GET  /api/routeros-resources/history/:id        — detalle de una generación
```

---

## Riesgos

| Riesgo                              | Mitigación                                             |
|-------------------------------------|--------------------------------------------------------|
| Secretos expuestos en logs          | Nunca se loguea el script ni los passwords             |
| Reutilización de credenciales       | Cada generación crea credenciales únicas               |
| Script cacheado indefinidamente     | TTL de 1h en el cache de descarga                      |
| Historial con script completo       | Solo metadatos en el historial; el script nunca se persiste |
| Branding externo                    | `assertNoBrandViolation` lanza en el generador         |
| Políticas peligrosas                | `assertNoForbiddenPolicies` lanza en el generador      |
| Script que rompe la red del router  | Firewall conservador + advertencia de backup antes de importar |

---

## Buenas prácticas

1. **Siempre hacer backup** antes de importar:
   ```
   /system backup save name=backup-pre-nugacore
   ```
2. Probar el script primero en un router de laboratorio o CHR
3. Verificar que la interfaz WireGuard levantó y registrar la public-key en NugaCore
4. Revisar el firewall resultante con `/ip firewall filter print`
5. Usar la plantilla `lab_direct` solo en laboratorio — nunca en producción

---

## Siguiente fase

- `pcc_balancer`: plantilla de balanceo PCC con hasta 6 ISPs y failover automático
  (inspirada en el script de referencia analizado en `ROUTEROS_RESOURCE_GENERATOR_AUDIT.md`)
- Integración con el Worker MikroTik (Fase 4.6) para aplicar los scripts automáticamente
  a routers registrados

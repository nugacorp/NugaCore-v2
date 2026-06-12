# Auditoría del Script de Referencia — balanceadorV5.rsc

## Propósito de este documento

Análisis del script `balanceadorV5.rsc` (Livaur SGCM v5.2.2, RouterOS v7) como referencia de arquitectura.
Define qué conceptos reutilizamos en el generador de recursos de NugaCore y qué descartamos.

---

## 1. Conceptos que reutilizamos

### 1.1 Estructura general del script

El script aplica configuración en secciones bien delimitadas con comentarios `# ---`. Se respeta esa
convención en NugaCore: cada bloque tiene un encabezado de sección y un número de paso.

### 1.2 Estrategia de idempotencia

El script usa `:if ([:len [find ...]] = 0) do={ add ... }` para evitar duplicar configuraciones
preexistentes. NugaCore adopta el mismo patrón con prefijo `NugaCore` en todos los comments para
distinguir configuración propia de configuración manual del operador.

También usa `/X remove [find where comment~"NugaCore"]` para limpiar la config NugaCore previa
antes de recrearla (reinicio limpio sin afectar configuración ajena).

### 1.3 Renombrado de interfaces con `comment`

El script registra el nombre físico original en el campo `comment` de la interfaz:
```
/interface/ethernet/set [find name="ether1"] name="WAN1" comment="ether1"
```
NugaCore usa la misma técnica pero SOLO para comentar el WAN, sin renombrar, para respetar la
nomenclatura previa del operador.

### 1.4 Bridge LAN

`/interface/bridge/add fast-forward=no name="bridgeLAN"` — adoptamos el mismo patrón con nombre
configurable `lanBridgeName` y fast-forward=no por compatibilidad v6/v7.

### 1.5 Interface Lists (WAN/LAN)

Uso de `:if ([:len [find name=WAN]] = 0) do={ add name=WAN }` para crear las listas si no existen.
NugaCore sigue el mismo patrón para garantizar idempotencia.

### 1.6 DHCP Server + Pool + Network

Estructura tripartita en tres secciones separadas (`/ip/pool`, `/ip/dhcp-server`,
`/ip/dhcp-server/network`) con parámetros de gateway, dns-server, netmask. NugaCore parametriza
cada campo.

### 1.7 DNS

`/ip/dns/set allow-remote-requests=yes servers="<dns>"` — adoptado directamente.

### 1.8 NAT masquerade

`/ip/firewall/nat add action=masquerade chain=srcnat out-interface-list=WAN` — patrón estándar
para cualquier WISP. Adoptado con `comment="NugaCore NAT"` para idempotencia.

### 1.9 Scheduler watchdog

Patrón de scheduler con `interval=` para verificar conectividad. NugaCore lo usa para monitorear
el túnel WireGuard/SSTP y loguear estado.

### 1.10 System note

`/system/note/set note="..."` para dejar una tarjeta de identidad del script en el router.
NugaCore adapta con su branding.

### 1.11 Cleanup del archivo .rsc

```
/file remove [find name~"balanceadorV5.rsc"]
```
NugaCore replica:
```
/file remove [find name~"nugacore-"]
```
Limpia el .rsc del almacenamiento del router tras la importación.

### 1.12 Comentario de compatibilidad

El header indica versión de RouterOS requerida y fecha de generación. NugaCore incluye fecha,
versión del generador y advertencia de backup.

---

## 2. Conceptos que NO copiamos

### 2.1 Marca y branding Livaur

Todo el contenido de `system note`, comentarios de scripts, links a livaur.com y referencias
al SGCM son propiedad de Livaur. El generador de NugaCore usa exclusivamente la marca NugaCore.

### 2.2 Scripts de failover PCC complejos

`failoverIsp1..6`, `failoverCheckIsp`, `failoverActualizadorReglasMangleBalanceador`, etc. son
algoritmos propietarios de Livaur. En NugaCore Fase 4.6.2 no incluimos balanceo PCC; eso queda
para una plantilla futura (`pcc_balancer`).

### 2.3 VRF de monitoreo

El script usa VRFs (`/ip/vrf/add name="monitor_to_ISP1"`) para aislar el ping de monitoreo por
interfaz. Es parte del sistema de failover de Livaur. No se incluye en esta fase.

### 2.4 Routing tables to_ISP1..6

Las routing tables para balanceo PCC son específicas del failover Livaur. No aplican a la
plantilla base de NugaCore.

### 2.5 Políticas con `sniff`, `sensitive`, `romon`

El script de referencia usa `policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon`
en todos los scripts. NugaCore sigue una política de mínimo privilegio:

| Política   | Referencia | NugaCore | Razón de exclusión                         |
|------------|-----------|----------|--------------------------------------------|
| sniff      | ✅        | ❌       | Captura de paquetes — innecesario para API |
| sensitive  | ✅        | ❌       | Acceso a secretos del sistema              |
| romon      | ✅        | ❌       | Descubrimiento de red — no requerido       |
| reboot     | ✅        | ❌       | Reinicio del equipo — peligroso vía API    |
| password   | ✅        | ❌       | Cambio de contraseñas — no necesario       |
| policy     | ✅        | ❌       | Gestión de políticas — no necesario        |
| ftp        | ✅        | ❌       | Transferencia de archivos — no necesario   |

**Política NugaCore**: `read,write,api,test` (idéntica a la del provisioning MikroTik existente).

### 2.6 Scheduler `lanzadorFailover` con verificación de job en ejecución

El patrón de verificar si el script ya está corriendo con `/system/script/job/find` es específico
del sistema multi-ISP. El watchdog de NugaCore es más simple.

### 2.7 DHCP clients WAN con scripts embebidos

El script configura DHCP clients con scripts RouterScript para actualizar rutas dinámicamente.
NugaCore no incluye esto en la plantilla base — el operador configura sus WANs manualmente.

### 2.8 Per-Connection Classifier (PCC) mangle rules

Las reglas `per-connection-classifier=both-addresses:6/N` son para balanceo PCC. No aplican
a la plantilla base de NugaCore.

### 2.9 Address-lists de clientes por ISP

`clients_to_ISP1..6` son específicas del balanceo. No aplican.

---

## 3. Mapa de secciones del script NugaCore

Secciones que contiene el script generado `base_wisp_wireguard`:

```
Header (advertencia, fecha, versión)
  │
  ├─ 1. Cleanup idempotente (config NugaCore previa)
  ├─ 2. Identity (/system identity)
  ├─ 3. Interfaces: comment WAN + crear bridge LAN
  ├─ 4. Puertos LAN al bridge
  ├─ 5. Interface Lists (WAN / LAN)
  ├─ 6. IP LAN (/ip address)
  ├─ 7. DHCP Pool
  ├─ 8. DHCP Server + Network
  ├─ 9. DNS
  ├─ 10. NAT masquerade
  ├─ 11. Firewall básico (established/related + drop input WAN)
  ├─ 12. Grupo NugaCore + usuario API (mínimo privilegio)
  ├─ 13. API service limitada al CIDR VPN
  ├─ 14. WireGuard interface + peer + ruta management
  ├─ 15. Watchdog scheduler
  ├─ 16. System note
  └─ 17. Cleanup del archivo .rsc
```

---

## 4. Diferencias clave respecto al script de referencia

| Aspecto                   | balanceadorV5 (Livaur) | NugaCore Resource Generator |
|---------------------------|------------------------|-----------------------------|
| Marca                     | Livaur                 | NugaCore                    |
| Objetivo principal        | Balanceo PCC 6 ISPs    | Conectar router a NugaCore  |
| Credenciales API          | No incluye             | Genera usuario mínimo       |
| VPN                       | No incluye             | WireGuard o SSTP            |
| Firewall básico           | No incluye             | Incluido (conservador)      |
| Políticas de usuario      | Máximas (sniff, etc.)  | Mínimas (read,write,api,test)|
| Balanceo PCC              | Sí (6 ISPs)            | No (plantilla futura)       |
| Idempotencia              | Parcial                | Completa (prefijo NugaCore) |
| Secretos visibles         | No aplica              | Una sola vez, jamás persiste|

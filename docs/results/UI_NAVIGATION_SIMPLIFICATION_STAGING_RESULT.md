# UX Simplification / WISP Navigation — Staging Result

Fecha: 2026-06-21  
Commit solicitado: `dedf575 refactor(ui): simplify wisp navigation and dashboard hierarchy`

## Resultado final

❌ **UX SIMPLIFICATION NO APROBADA TODAVÍA**

La navegación, jerarquía visual, roles y Dashboard cumplen el objetivo principal,
pero quedaron dos bloqueadores:

1. El módulo **Pagos** genera dos respuestas HTTP 401 al abrirse:
   `/api/payments/orders` y `/api/payments/actions`.
2. No fue posible certificar el estado `healthy` del contenedor ni escanear los
   logs del contenedor porque SSH reportó un cambio de host key. No se omitió ni
   sobrescribió esa protección.

No se avanzó a PROD-5, no se conectó CHR real, no se activó RouterOS y no se
tocaron routers reales.

## Commit y despliegue observado

- Checkout local y `origin/main`: `dedf57541aa73503923d850cad250d302376e9e1`.
- `git log --oneline -15`: contiene `dedf575` como HEAD.
- El bundle público de staging incluyó marcadores exclusivos del commit:
  `Resumen operativo`, `Laboratorio MikroTik`, `Manual de Usuario`,
  `Pendiente de cobro` y `Red requiere atención`.
- Asset observado: `/assets/index-BL1qd0tx.js`.
- El endpoint de salud reportó ambiente `staging`, persistencia `mixed` y uptime
  reciente después del auto-deploy.

Limitación: no se pudo ejecutar ni certificar el checkout en
`/opt/nugacore-staging`, el redeploy desde Coolify ni `docker inspect` debido al
cambio no verificado de host key SSH.

## Healthchecks

Validación pública posterior al despliegue:

| Endpoint | Resultado |
| --- | --- |
| `/api/health` | 200 |
| `/api/health/live` | 200 |
| `/api/health/ready` | 200 |

Una corrida limpia de navegador no produjo respuestas 429. Varias corridas
acumuladas de automatización sí agotaron temporalmente el límite global de 300
solicitudes por 15 minutos; después del reset, la validación limpia volvió a
ejecutarse sin 429.

## Checks

Ejecutados sobre el mismo HEAD `dedf575`:

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 81 archivos pasaron.
  - 7 archivos omitidos.
  - 1302 tests pasaron.
  - 46 tests omitidos.
- `npm run build`: PASS.

## Sidebar final — Super Admin

Validado en el navegador contra staging:

```text
Inicio
  - Dashboard

Clientes
  - Clientes
  - Tickets
  - Pagos
  - Facturación / Planes
  - Suspensiones

Red
  - NOC
  - Mapa / Infraestructura
  - Torres y Sitios
  - Inventario

MikroTik
  - Routers
  - Panel MikroTik
  - Alta de Router
  - Plantillas
  - Scripts
  - Laboratorio MikroTik

Reportes
  - Analytics

Sistema
  - Configuración
  - Manual de Usuario
```

Resultado:

- Secciones exactas: PASS.
- Routers dentro de MikroTik: PASS.
- Sin módulos duplicados: PASS.
- Sin IDs duplicados o huérfanos detectados: PASS.
- `activeTab` y resaltado del módulo activo: PASS.

## Módulos ocultos del sidebar

No aparecen como módulos normales:

- WireGuard.
- Modo Seguro Manual / Manual Safe Mode.
- Safe Command Queue.
- Cola Dry-Run.
- Cola de Comandos.

El código, los tabs internos, RBAC y tests asociados permanecen en el repositorio.

## Roles

Validación con los seis usuarios reales de staging mediante sesiones efímeras;
JWTs y credenciales no fueron impresos:

- Super Admin: PASS.
- Administrador: PASS.
- Cobranza: PASS.
- Técnico: PASS.
- Soporte: PASS.
- Solo lectura: PASS.

`Manual de Usuario` fue visible y abrió correctamente para todos los roles.
Cobranza mostró únicamente:

- Dashboard.
- Clientes.
- Pagos.
- Facturación / Planes.
- Suspensiones.
- Analytics.
- Manual de Usuario.

Cobranza no mostró NOC, Tickets, Red, Inventario, MikroTik, Alta de Router,
Laboratorio MikroTik ni Configuración.

## Dashboard operativo

Validado arriba de la primera vista:

- Resumen operativo: PASS.
- Estado general de la red: PASS.
- Alertas NOC: PASS.
- Suscriptores activos: PASS.
- Suspendidos: PASS.
- Tickets abiertos: PASS.
- Pendiente de cobro: PASS.
- Ingresos del mes: PASS.
- Sin tablas largas dentro del viewport inicial: PASS.

Los cinco KPIs navegaron y activaron el módulo correcto:

- Suscriptores activos → Clientes.
- Suspendidos → Suspensiones.
- Tickets abiertos → Tickets.
- Pendiente de cobro → Facturación / Planes.
- Ingresos del mes → Analytics.

Observación menor: el requerimiento usa la etiqueta “Clientes activos”; la UI
desplegada usa “Suscriptores activos”.

## Validación visual

- Paleta principal y fondo slate: conservados.
- Tema oscuro global: conservado.
- Branding `NugaCore` y `WISP & FTTH ERP v2.4`: conservado.
- Tipografía global: conservada.
- `src/index.css`, assets e `index.html`: sin cambios en `dedf575`.
- No se introdujo una librería visual ni un tema nuevo.

## Módulos críticos

Se abrieron sin pantalla en blanco y con navegación funcional:

- Clientes.
- Tickets.
- Pagos.
- Facturación / Planes.
- Suspensiones.
- NOC.
- Inventario.
- Routers.
- Alta de Router.
- Laboratorio MikroTik.
- Manual de Usuario.

Hallazgo bloqueante en **Pagos**:

- `GET /api/payments/orders` → 401.
- `GET /api/payments/actions` → 401.

La causa observada en código es que `PaymentsModule` envía `x-user-role` y
`x-user-id`; en staging/producción esos trusted headers se ignoran y la identidad
debe venir del JWT. El módulo no recibe ni usa `getAuthHeaders`, a diferencia de
los módulos críticos read-only.

No se observaron errores de página ni 429 en la corrida limpia. Los dos 401 de
Pagos sí aparecen como errores de carga en la consola del navegador.

## Seguridad y logs

- No se imprimieron JWTs, service-role keys, passwords, private keys,
  preshared keys ni scripts RouterOS completos durante la validación.
- El escaneo de logs recientes del contenedor queda **PENDIENTE**: SSH rechazó la
  conexión por cambio de host key y no se desactivó la verificación.
- Por lo anterior no se certifica todavía la ausencia de secretos en logs del
  contenedor final.

## Acciones requeridas para aprobar

1. Corregir `PaymentsModule` para autenticar sus requests con Bearer JWT.
2. Verificar por un canal confiable la nueva host key SSH del VPS.
3. Confirmar checkout `/opt/nugacore-staging`, contenedor `healthy` y logs
   recientes sin secretos.
4. Repetir el smoke test de Pagos, consola, 429 y healthchecks.

No se crea commit documental ni se hace push mientras estos puntos no pasen.
No avanzar a PROD-5.

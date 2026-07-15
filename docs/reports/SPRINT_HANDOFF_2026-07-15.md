# NugaCore — Handoff de sprint (julio 2026)

> Documentación pública de lo implementado y validado hasta **2026-07-15**.
> Sanitizada: sin contraseñas, tokens, JWTs, claves privadas ni logs operativos crudos.
> HEAD de referencia en `main` al cerrar este handoff: `c914439` (jul 2026 sprint router/WG).
> HEAD `main` posterior: `cebcc6d`. Rama UI cleanup desplegada en staging: `b66e0b1` (PR #31).
> Auditoría producción: [`PRODUCTION_GAP_REPORT.md`](./PRODUCTION_GAP_REPORT.md) (2026-07-15).

## 1. Objetivo del periodo

Dejar el flujo WISP de **alta de router MikroTik vía WireGuard** listo para operar en staging:

1. Scripts `.rsc` importables en CHR/RouterOS 7 sin errores de sintaxis.
2. Inventario alineado con enrollment (alta → aparece; revocar → desaparece).
3. UX: el alta vive dentro de **MikroTik → Routers** (no sección suelta).
4. El peer WireGuard se aplica **automáticamente** en el `wg0` del VPS (sin sync manual).

## 2. Qué existe hoy (código + comportamiento)

### 2.1 Plantillas RouterOS / enrollment `.rsc`

| Tema | Comportamiento | Código principal |
| --- | --- | --- |
| Nombre de archivo corto | `nc-wg.rsc` (genérico, sin slug de equipo) | `backend/domains/routeros-templates/rsc-filename.ts` |
| Private key WireGuard | `set` top-level fuera de `:if do={}` (evita “invalid private key”) | `generator.ts` → `sectionWireguard` |
| Placeholders WG | No se emiten claves/endpoint/`0.0.0.0` inválidos que abortan `/import` | `generator.ts` |
| Bridge / LAN | Crea `bridge-lan` + IP/DHCP si aplica; **no** agrega ports WAN/LAN automáticamente | `generator.ts` |
| `/ip service` | `find where name=… and dynamic=no` (compatible ROS 7.19+) | `generator.ts` |
| applyMode | `factory_reset` vs `existing_config` | templates + enrollment mapper |
| Enrollment → plantilla | `enableLanStack` con `lanInterfaces: []` por defecto | `backend/domains/router-enrollment/template-mapper.ts` |

Docs relacionadas: [`docs/mikrotik/ROUTEROS_RSC_IMPORT_HARDENING.md`](../mikrotik/ROUTEROS_RSC_IMPORT_HARDENING.md).

### 2.2 Enrollment ↔ inventario MikroTik

| Acción | Efecto |
| --- | --- |
| Alta / start enrollment | Crea/reusa peer WG + fila en `mikrotik_routers` (creds API cifradas) |
| Download `.rsc` | Reusa username/password API persistidos |
| Revocar / eliminar enrollment | Quita peer (revocado) **y** borra el router del inventario |
| check-online (live, si gate ON) | Persiste estado del router |

Código: `backend/domains/router-enrollment/service.ts`, `backend/domains/mikrotik/repository.ts`.  
UI inventario: `src/components/InventoryRoutersModule.tsx`.

### 2.3 UX — Alta dentro de Routers

| Antes | Ahora |
| --- | --- |
| Sidebar: Alta de Router + Routers + Plantillas | Sidebar: **Routers** + **Plantillas** |
| Alta = tab aparte | Botón **Dar de alta** dentro de Routers → `RouterEnrollmentWizard` |

- `router-enrollment` sigue en RBAC pero está en `SIDEBAR_HIDDEN_TABS`.
- Quick action Dashboard / deep-link redirige a Routers con panel de alta.
- Manual de usuario actualizado.

Código: `src/components/InventoryRoutersModule.tsx`, `src/App.tsx`, `src/lib/rbac.ts`, `src/components/Sidebar.tsx`.  
Doc: [`docs/frontend/ROUTERS_MODULE_UX.md`](../frontend/ROUTERS_MODULE_UX.md).

### 2.4 WireGuard host-apply automático

Problema resuelto: el peer quedaba solo en Supabase/DB mientras `wg0` del VPS tenía claves viejas → sin handshake → ping VPN en timeout.

| Pieza | Rol |
| --- | --- |
| `backend/domains/wireguard/host-apply.ts` | Cliente HTTP + reconcile periódico |
| `WireguardService` create/rotate/revoke | Tras mutar, `flushHostPeerSync()` (set completo de peers activos) |
| `scripts/vps/wg-host-apply-agent.py` | Agente root: POST `/apply` → reescribe conf + `wg syncconf` |
| `scripts/vps/install-wg-host-apply-agent.sh` | systemd `nugacore-wg-host-apply` |
| Env Coolify | `WIREGUARD_HOST_APPLY_URL`, `WIREGUARD_HOST_APPLY_TOKEN`, interval 60s |

`scripts/vps/sync-wireguard-peers.sh` queda solo como **recuperación**.  
Doc: [`docs/wireguard/WIREGUARD_HOST_APPLY.md`](../wireguard/WIREGUARD_HOST_APPLY.md).

### 2.5 SPA / MIME

Assets `.js` faltantes → **404 texto**, no `index.html` (evita MIME `text/html` en módulos).  
Service worker shell bump (`nugacore-shell-v3`).  
Código: `server.ts`, `public/sw.js`.

### 2.6 Otros merged en el mismo periodo (contexto)

- Reorganización sidebar WISP LATAM (7 secciones).
- Dashboard con estado por zona / acciones rápidas.
- PWA multi-app (Admin / Técnicos / Portal) — fundación.
- Reuso de IPAM WG released sin INSERT duplicado.
- Skills de agente vendored (`agent/skills/`) + `AGENTS.md`.
- Datos reales Supabase (sin mocks MikroTik) cuando flags DB ON.

## 3. Staging — estado operativo (sanitizado)

| Ítem | Estado |
| --- | --- |
| App staging | Coolify app `nugacore-staging`, health `/api/health/live` = 200 |
| Flags relevantes | `USE_DB_WIREGUARD=true`, `USE_DB_ROUTER_ENROLLMENT=true`, `USE_DB_MIKROTIK=true` |
| Host-apply | Servicio `nugacore-wg-host-apply` activo; app hace POST `/apply` al arrancar/reconcile |
| `MIKROTIK_WORKER_LIVE` | **false** (no habilitar sin autorización explícita) |
| CHR piloto | Túnel WG validado tras host-apply (handshake + ping VPN) |
| Deploy | `scripts/vps/deploy-coolify-staging.sh` con `BRANCH=main` |

Evidencia resumida: [`docs/results/WG_HOST_APPLY_STAGING_RESULT.md`](../results/WG_HOST_APPLY_STAGING_RESULT.md).

## 4. Flujo operativo WISP (día a día)

```
MikroTik → Routers → [Dar de alta]
  → wizard (datos → WG server → LAN → generar → descargar → importar → check online)
  → NugaCore crea peer + aplica wg0 automáticamente
  → técnico importa nc-wg.rsc en el router
  → handshake WG → router en inventario
```

Revocar enrollment → peer revocado + fila inventario eliminada + host-apply quita pubkey de `wg0`.

## 5. Mapa de archivos clave

```
backend/domains/routeros-templates/   # generator, types, rsc-filename
backend/domains/router-enrollment/    # service, template-mapper, routes
backend/domains/wireguard/            # service, host-apply, ipam, keys
backend/domains/mikrotik/             # repository (inventario routers)
scripts/vps/                          # deploy, wg agent, install, sync recovery
src/components/InventoryRoutersModule.tsx
src/components/RouterEnrollmentWizard.tsx
src/lib/rbac.ts                       # SIDEBAR_HIDDEN_TABS
tests/unit/wireguard.host-apply.test.ts
tests/unit/navigation.ui.test.ts
```

## 6. Qué falta / gates de producción

| Gate | Notas |
| --- | --- |
| `MIKROTIK_WORKER_LIVE` | Sigue apagado; check-online “real” y writes requieren autorización |
| Host-apply en otros entornos | Instalar agente + env URL/token (staging ya cableado en deploy) |
| Multi-servidor WG / multi-tenant | Arquitectura actual: un servidor default por despliegue |
| Observabilidad host-apply | Logs del agente + logger app; sin métricas Prometheus dedicadas aún |
| Hermes / checklist prod | Seguir `docs/deployment/PRODUCTION_READINESS_CHECKLIST.md` |

## 7. Guardrails (no olvidar)

- No commits con secretos / JWTs / passwords / private keys.
- No cambiar passwords compartidos de staging sin pedido explícito.
- No activar live RouterOS / migraciones destructivas sin autorización.
- Validaciones staging: confirmar commit en `origin/main` antes de aprobar.

## 8. Cómo continuar (handoff frío)

1. Leer este documento + [`docs/planning/DEVELOPMENT_HANDOFF_CHECKLIST.md`](../planning/DEVELOPMENT_HANDOFF_CHECKLIST.md) §0.
2. Cargar skills: `agent/skills/software-development/wisp-noc-saas-development/SKILL.md`.
3. Para WG/alta: `docs/wireguard/*` y runbooks en `docs/runbooks/`.
4. Verificar HEAD: `git log -1 --oneline origin/main`.
5. Staging deploy: `BRANCH=main bash scripts/vps/deploy-coolify-staging.sh` (como root en VPS vía SSH aprobado).

## 9. Commits de referencia (más reciente primero)

- `c914439` — feat(wireguard): apply automático de peers al host wg0 (#19)
- `521c5fc` — feat(ui): mover alta de router dentro de Routers (#18)
- `b49ad75` — fix(enrollment): sync inventario al revocar y persistir API creds
- `25839e2` — fix(ui): no servir index.html para assets .js faltantes (MIME)
- `468ed0b` … `d39dfb2` — endurecimiento import `.rsc` / WireGuard / bridge / ROS 7.19+

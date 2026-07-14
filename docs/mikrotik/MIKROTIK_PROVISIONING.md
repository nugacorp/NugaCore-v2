# MIKROTIK PROVISIONING — Fase 4.4

Fecha: 2026-06-05
Estado: generador de script + registro de routers. **Sin worker, sin acciones
reales sobre routers.** `test-connection` es dry-run.

Auditoría previa: [MIKROTIK_PROVISIONING_AUDIT.md](../audits/MIKROTIK_PROVISIONING_AUDIT.md).

## 1. Arquitectura

```
UI (MikrotikRoutersPanel) ──> App handlers ──> Express /api/mikrotik/*
                                                    │
                          ┌─────────────────────────┼─────────────────────────┐
                          ▼                          ▼                         ▼
              provisioning/credentials.ts   provisioning/script-generator.ts  provisioning/store.ts
              (usuario+password+token,        (script RouterOS SSTP/WG,        (tokens/scripts/audit:
               cifra con MIKROTIK_*_KEY)        idempotente, perms mínimos)     SOLO metadata/hashes)
```

- **Backend**: `backend/domains/mikrotik/provisioning/` (`credentials.ts`, `script-generator.ts`, `store.ts`, `types.ts`) + endpoints en `routes.ts`.
- **Persistencia**: hoy en memoria (`USE_DB_MIKROTIK=false`). La migración `supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql` deja listo el esquema (5 tablas + RLS) para activarlo después.
- **Frontend**: `src/components/MikrotikRoutersPanel.tsx` dentro del módulo MikroTik, helpers `src/lib/mikrotikView.ts` y `src/lib/mikrotikRbac.ts`.

## 2. Modelo de seguridad

- **Credenciales**: el password API se genera aleatorio (≥32, criptográfico) y se guarda **cifrado** (AES-256-GCM con `MIKROTIK_CREDENTIALS_KEY`). Nunca en texto plano, nunca en logs.
- **Script de un solo vistazo**: el endpoint devuelve el script (con secretos) **una sola vez**; en el servidor solo se persiste `script_hash` + metadata. La UI lo muestra en un modal y se descarta al cerrar.
- **Token de provisioning**: un solo uso, expirable; se guarda solo `token_hash` (sha256).
- **Auditoría**: cada acción (create / generate_script / rotate_credentials / test_connection) queda registrada con actor; el resumen **enmascara** el password (`maskSecret`).
- **API limitada a la VPN**: el script fija `/ip service set api address="<vpn_cidr>"` → la API solo responde dentro de la red de NugaCore (no expuesta a internet).
- **Permisos mínimos**: grupo `nugacore` con `policy="read,write,api,test"`. Excluye `sniff, sensitive, romon, reboot, password, policy, ftp`.
- **RBAC** (backend + UI): Cobranza sin acceso; ver = SA/Admin/Téc/Soporte/Solo lectura; crear-editar = SA/Admin; generar-script + test = SA/Admin/Téc; rotar = SA/Admin.

## 3. WireGuard vs SSTP

| | WireGuard (preferido) | SSTP (alternativa) |
|---|---|---|
| RouterOS | v7 | v6 y v7 |
| Cifrado | moderno (Curve25519/ChaCha20) | TLS/PPP |
| Intercambio de claves | requiere registrar la public-key del router en el servidor (paso manual) | usuario/clave PPP (en el script) |
| Recomendación | usar si el router es v7 | usar si v6 o sin WireGuard |

**Flujo de claves WireGuard:**
1. NugaCore genera el peer del servidor (public key + endpoint) y lo incrusta en el script.
2. El router genera su **private-key** automáticamente al crear `NugaCoreWG`.
3. El operador ejecuta `/interface wireguard print` y copia la **public-key del router**.
4. Esa public-key se registra en NugaCore para completar el túnel.

Si no hay servidor WireGuard aún, el script queda preparado con placeholders y warnings; se completa cuando exista el concentrador.

## 4. Cómo generar el script

1. Módulo **MikroTik → Routers MikroTik**.
2. "Registrar Router" (nombre, IP de administración, tipo de conexión, puerto API).
3. En la tarjeta del router, elegir WireGuard/SSTP y pulsar **Generar Script**.
4. Se abre un modal con: advertencia de seguridad, usuario API, **token** (un solo uso), hash y el **script**. Botón **Copiar**.
5. **Guárdalo ahora**: al cerrar no se vuelve a mostrar (NugaCore solo conserva el hash).

## 5. Cómo pegarlo en el router

1. Conéctate al router (Winbox/SSH) con un usuario admin.
2. Pega el script completo en la terminal de RouterOS.
3. Verifica: `/user group print` (grupo `nugacore`), `/ip service print` (api con address=vpn), la interfaz VPN (`NugaCoreVPN` o `NugaCoreWG`) y el scheduler.
4. (WireGuard) ejecuta `/interface wireguard print`, copia la public-key del router y regístrala en NugaCore.

## 6. Qué permisos usa (y por qué)

`policy="read,write,api,test"`:
- `read` — leer interfaces, queues, ppp.
- `write` — alta/suspensión/reactivación/velocidad de clientes (fases siguientes).
- `api` — acceso vía API.
- `test` — ping/bandwidth-test de diagnóstico.

Excluidos a propósito: `sniff`, `sensitive`, `romon`, `reboot`, `password`, `policy`, `ftp`.

## 7. Cómo probar la conexión

- Botón **Probar (dry-run)** → `POST /api/mikrotik/routers/:id/test-connection`.
- **No abre conexión real** (aún no hay worker). Valida que el router tenga credenciales, tipo de conexión y puerto API válidos, y devuelve un checklist.
- La validación real de conectividad llega con el **Worker MikroTik** (fase siguiente).

## 8. Cómo rotar credenciales

- Botón **Rotar credenciales** (SA/Admin) → confirma → `POST /:id/rotate-credentials { confirm: true }`.
- Genera credenciales nuevas (invalida las previas) y **un script nuevo** que debe volver a pegarse en el router.

## 9. Ejemplo de script generado (secretos ENMASCARADOS)

> El script real incluye el password en claro (para pegarlo en el router). Aquí va enmascarado.

```routeros
# ============================================================
# NugaCore — Provisioning Script (SSTP)  nugacore-1.0
# Router: Router Core Norte
# Genera: VPN SSTP + usuario API con permisos MINIMOS (read,write,api,test)
# Idempotente: elimina la configuracion NugaCore previa y la recrea.
# La API queda limitada a la red VPN de NugaCore.
# ============================================================

# --- 1. Limpieza idempotente de configuracion NugaCore previa ---
/user remove [find where name~"nugacore_"]
/user group remove [find where name~"nugacore"]
/ip route remove [find where comment~"NugaCore"]
/ip address remove [find where comment~"NugaCore"]
/interface sstp-client remove [find where name~"NugaCore"]
/ppp profile remove [find where name~"nugacore"]

# --- 2. Grupo con permisos minimos ---
/user group add name=nugacore policy="read,write,api,test" comment="NugaCore minimal API group"

# --- 3. Usuario API NugaCore ---
/user add name="nugacore_ab12cd" password="****REDACTED****" group=nugacore comment="NugaCore API user"

# --- 4. Perfil PPP NugaCore ---
/ppp profile add name=nugacore-profile comment="NugaCore VPN profile"

# --- 5. Cliente SSTP hacia el concentrador NugaCore ---
/interface sstp-client add name="NugaCoreVPN" connect-to="vpn.nugacore.local" user="nugacore_vpn34" password="****REDACTED****" profile="nugacore-profile" comment="NugaCore VPN" add-default-route=no disabled=no

# --- 6. Ruta hacia la red de administracion NugaCore ---
/ip route add dst-address="10.0.0.0/24" gateway=NugaCoreVPN comment="NugaCore management route"

# --- 7. API limitada a la red VPN de NugaCore ---
/ip service set api port=8728 address="10.10.0.0/24" disabled=no
/ip service set api-ssl address="10.10.0.0/24"

# --- 8. Scheduler de reconexion VPN ---
/system scheduler add name=NugaCore-VPN-Watchdog interval=00:01:00 comment="NugaCore VPN reconnect watchdog" on-event="/interface sstp-client enable [find where name=\"NugaCoreVPN\" disabled=yes]"

# ============================================================
# Fin del script NugaCore (SSTP). La API solo responde dentro de 10.10.0.0/24.
# ============================================================
```

## 10. Endpoints

| Método | Ruta | RBAC |
|---|---|---|
| GET | `/api/mikrotik/routers` | SA/Admin/Téc/Soporte/Solo lectura |
| GET | `/api/mikrotik/routers/:id` | idem |
| POST | `/api/mikrotik/routers` | SA/Admin |
| PUT | `/api/mikrotik/routers/:id` | SA/Admin |
| POST | `/api/mikrotik/routers/:id/provisioning-script` | SA/Admin/Téc |
| POST | `/api/mikrotik/routers/:id/rotate-credentials` | SA/Admin (requiere `confirm:true`) |
| POST | `/api/mikrotik/routers/:id/test-connection` | SA/Admin/Téc (dry-run) |

Variables de servidor (opcionales; placeholders seguros si faltan):
`MIKROTIK_VPN_HOST`, `MIKROTIK_VPN_CIDR`, `MIKROTIK_MGMT_CIDR`, `MIKROTIK_WG_SERVER_PUBKEY`, `MIKROTIK_WG_ENDPOINT`.

## 11. Riesgos

- El script contiene secretos en claro al generarse (necesario para pegarlo). Mitigación: se muestra una vez, no se persiste, no se loguea; usar canal seguro al pegarlo.
- WireGuard requiere registrar la public-key del router en el servidor (paso manual) hasta que exista automatización.
- Sin worker: la conectividad real no se valida todavía (dry-run).
- `MIKROTIK_CREDENTIALS_KEY` es obligatoria en producción; si se rota, los blobs cifrados previos dejan de descifrarse (re-provisionar).
- La persistencia DB (5 tablas) está creada pero **no activa** (`USE_DB_MIKROTIK=false`): el registro vive en memoria y se reinicia con el proceso.

## 12. Siguiente fase: Worker MikroTik

- Conexión real vía API RouterOS (sobre la VPN) usando las credenciales cifradas.
- `test-connection` real (no dry-run).
- Lecturas reales (interfaces, queues, PPP secrets) y acciones (alta, suspensión, reactivación, velocidad, baja) con confirmaciones y auditoría.
- Activar `USE_DB_MIKROTIK=true` + repository Supabase con el esquema de esta fase.

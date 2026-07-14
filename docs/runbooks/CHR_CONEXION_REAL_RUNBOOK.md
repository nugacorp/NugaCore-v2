# CHR Real — Runbook de conexión al sistema (read-only)

Fecha: 2026-07-06 · Complementa `docs/CHR_LAB_PREP_RUNBOOK.md` (provisión y hardening
del CHR). Este runbook cubre lo que sigue: configurar RouterOS **desde 0** para que
NugaCore lo lea, conectar el sistema por env, y validar con el smoke script.

Alcance PROD-4: **solo lectura**. Sin `MIKROTIK_WORKER_LIVE`, sin commit mode, sin
escrituras. El provider cae a mock automáticamente si el CHR no responde (API 200,
`source=mock`) — conectar el CHR nunca puede tirar el sistema.

---

## 1. Configurar el CHR desde 0 (consola RouterOS)

Pegar en la terminal del CHR (Winbox/SSH). Ajusta `TU_IP_DE_GESTION`.

```routeros
# 1.1 Identidad
/system identity set name=chr-lab-nuga

# 1.2 Grupo de SOLO LECTURA con acceso a la REST API
/user group add name=nuga-readonly policy=read,rest-api,api

# 1.3 Usuario dedicado para NugaCore (cambia el password)
/user add name=nuga-ro group=nuga-readonly password=CAMBIA_ESTE_PASSWORD

# 1.4 Certificado self-signed + www-ssl (REST API va sobre HTTPS)
/certificate add name=chr-ssl common-name=chr-lab-nuga key-usage=key-cert-sign,digital-signature,key-encipherment,tls-server
/certificate sign chr-ssl
/ip service set www-ssl certificate=chr-ssl disabled=no port=443

# 1.5 Restringir el servicio a tu IP de gestión (recomendado)
/ip service set www-ssl address=TU_IP_DE_GESTION/32

# 1.6 Apagar servicios que no se usan (hardening mínimo)
/ip service disable telnet,ftp,www
```

Verificación rápida desde tu máquina:
`curl -k -u nuga-ro:PASSWORD https://IP_DEL_CHR/rest/system/identity`
→ debe devolver `{"name":"chr-lab-nuga"}`.

## 2. Backup antes de cualquier prueba

```routeros
/system backup save name=pre-nuga
/export file=pre-nuga-export
```

## 3. Conectar NugaCore (.env)

```env
ROUTEROS_READONLY_PROVIDER=routeros
ROUTEROS_HOST=IP_DEL_CHR
ROUTEROS_PORT=443
ROUTEROS_USERNAME=nuga-ro
ROUTEROS_PASSWORD=el_password_del_paso_1.3
ROUTEROS_TIMEOUT_MS=4000
# CHR de lab con cert self-signed:
ROUTEROS_TLS_REJECT_UNAUTHORIZED=false
```

Reglas: NO tocar `MIKROTIK_WORKER_LIVE` (queda `false`). NO activar `USE_DB_MIKROTIK`
ni `USE_DB_WIREGUARD`. El resto del `.env` no cambia.

## 4. Validar

1. `node scripts/chr-smoke.mjs` — en TU máquina (necesita alcance de red al CHR).
   Todos los checks obligatorios deben dar ✔.
2. Arrancar el sistema (`npm run dev`) → módulo **Laboratorio MikroTik** → las
   lecturas deben mostrar `source=live` (si muestra `source=mock`, el provider hizo
   fallback: revisar §5).
3. Confirmar en logs que NO aparecen password ni headers de auth (redacción activa).

## 5. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| `timeout` en smoke | Firewall / IP incorrecta / www-ssl deshabilitado | `/ip service print` en CHR; ping; revisar §1.4–1.5 |
| `401` | Password mal o grupo sin `rest-api` | `/user group print` — policy debe incluir `read,rest-api` |
| `ECONNREFUSED` | Puerto distinto | Confirmar puerto de www-ssl y `ROUTEROS_PORT` |
| Cert error | TLS estricto con self-signed | `ROUTEROS_TLS_REJECT_UNAUTHORIZED=false` (solo lab) |
| UI muestra `source=mock` | Cualquiera de las anteriores | El fallback es intencional; corregir y reintentar |

## 6. Crear usuarios del sistema (staff NugaCore)

Los usuarios del CRM viven en **Supabase Auth** (no hay endpoint local de alta):

1. Supabase Dashboard → Authentication → Users → *Add user* (email + password).
2. Asignar rol en la tabla de perfiles/roles según `docs/` de auth (roles válidos:
   `super admin`, `administrador`, `tecnico`, `soporte`, `cobranza`, `solo lectura`).
3. El backend valida el JWT de Supabase; en producción los trusted headers están
   prohibidos por fail-fast (`AUTH_TRUST_HEADERS=false`).

## 7. Qué sigue después de esto (gated)

Con el CHR conectado read-only y validado por Hermes (cerrar PROD-4), el orden del
roadmap es: PROD-5 Safe Command Queue dry-run contra CHR → PROD-6 primer comando
real en CHR de lab → piloto en router no crítico. Cada paso requiere autorización
explícita y NUNCA se salta la secuencia.

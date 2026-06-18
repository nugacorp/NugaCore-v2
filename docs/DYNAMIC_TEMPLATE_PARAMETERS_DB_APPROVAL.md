# Aprobación DB — Fase 4.9.2 Dynamic Template Parameters

> Documento formal de cierre. Sustituye el veredicto de la validación anterior en
> `docs/DYNAMIC_TEMPLATE_PARAMETERS_STAGING_RESULT.md` (que quedó NO APROBADA por un
> bloqueador de schema ya resuelto).

Fecha de emisión: 2026-06-18
Validación ejecutada por: **Hermes** (staging Coolify + Supabase staging)
Commit funcional validado: `a0c9b55` — `fix(router-enrollment): avoid wireguard store dependency in db downloads`

## Resultado

✅ **FASE 4.9.2 APROBADA**

La Fase 4.9.2.1 (Router/WireGuard Snapshot Persistence) ya estaba aprobada por Hermes
sobre el mismo commit `a0c9b55`. Esta aprobación cierra también la fase padre 4.9.2
(Dynamic Template Parameters) sobre persistencia real Supabase con restart.

## Flags del entorno validado

| Flag | Valor |
|---|---|
| `USE_DB_ROUTER_ENROLLMENT` | `true` |
| `USE_DB_WIREGUARD` | `false` |
| `USE_DB_MIKROTIK` | `false` |
| `MIKROTIK_WORKER_LIVE` | `false` |

## Prerrequisitos de DB validados

- Migración `20260617120000_router_enrollment_wireguard_snapshot.sql` aplicada.
- `NOTIFY pgrst, 'reload schema';` ejecutado.
- `RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs` → PASS.
- `RUN_DB_TESTS=true npm run test:db` → PASS.
- Historial de migraciones reconciliado (ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).

## Pruebas funcionales con restart real

### `pcc_5wan`

- `start` → enrollment creado en DB.
- Restart real del contenedor.
- `GET /api/router-enrollment/:id/download` post-restart = **200**.
- El script regenerado contiene los valores custom (LAN / interfaz / gateway),
  no plantilla por defecto.

### `router_base_wireguard`

- `start` → enrollment creado en DB.
- Restart real del contenedor.
- `GET /api/router-enrollment/:id/download` post-restart = **200**.
- El script regenerado contiene la configuración WireGuard esperada (`NugaCoreWG`).

## Seguridad / log hygiene

`wireguardSnapshot` saneado en respuestas y logs. NO expone:

- `privateKey`.
- `presharedKey`.
- `encryptedPeerPrivateKey`.
- `encryptedPresharedKey`.

Además:

- Logs sin secretos, tokens, JWT, service role ni scripts `.rsc` completos.
- No se tocaron routers reales.
- No se importaron scripts a routers.
- `MIKROTIK_WORKER_LIVE=false`; no se ejecutaron comandos RouterOS.

## Limpieza

- Artefactos de prueba (enrollments/peers test) limpiados tras la validación.

## Resultado final

**FASE 4.9.2 + 4.9.2.1 APROBADA.** Persistencia real Supabase con restart demostrada
para `pcc_5wan` y `router_base_wireguard`. No retomar 4.9.2 salvo regresión nueva
documentada.

## Siguiente tarea segura

**DB-1 — Reconciliar el schema de `mikrotik_routers`** antes de activar
`USE_DB_MIKROTIK` (ver `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md` §0.D). No activa flags
de MikroTik ni toca routers reales.

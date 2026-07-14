# NugaCore — Resultado de deploy STAGING (plantilla)

> Hermes: copia este archivo a `docs/COOLIFY_STAGING_RESULT.md`, rellénalo y guárdalo.
> **No pegues secretos** (ni keys, ni tokens, ni JWT). Enmascara cualquier valor sensible.

---

- **Fecha (UTC):** `____-__-__T__:__Z`
- **Commit desplegado:** `__________` (git rev-parse --short HEAD)
- **URL staging:** `https://__________`
- **VPS hostname:** `__________`

## Infraestructura
- **Docker:** versión `__________` · daemon OK: [ ]
- **Coolify app status:** `__________` (running / failed)
- **Imagen construida:** [ ] sí  [ ] no  · tiempo de build aprox: `____`

## Health checks
| Endpoint | Esperado | Obtenido |
|---|---|---|
| `/api/health/live` | 200 | `____` |
| `/api/health/ready` | 200 | `____` |
| `/api/health` | 200 | `____` |
| `persistence` | `mixed` (con `customers`) | `____` |

## API checks
- `/api/clients` → código `____` · ¿arreglo JSON? [ ] · registros aprox: `____`
- Salida de `validate-staging.sh`: `PASS / FAIL` → `____`

## Customers (DB)
- ¿Lee de Supabase? [ ] sí  [ ] no
- (Opcional) alta de prueba con JWT: `____` · limpieza: [ ] hecha  [ ] manual pendiente (id: `____`)

## Logs relevantes (sin secretos)
```
(pegar líneas clave del arranque / errores, enmascarando cualquier valor sensible)
```

## Errores encontrados
```
(describir; o "ninguno")
```

## Rollback
- Probado: [ ] sí  [ ] no
- Resultado: `__________`

## Estado final
- [ ] STAGING OPERATIVO
- [ ] CON OBSERVACIONES (detallar)
- [ ] FALLIDO (detallar)

## Próximo paso recomendado
- `__________________________________________`

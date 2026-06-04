# NugaCore — Estrategia de Pruebas

> Pre-Fase 3 · Objetivo: que `npm test` sea **hermético, estable y rápido** por
> defecto, y que las pruebas contra servicios reales (Supabase) sean un opt-in
> explícito que nunca contamine la suite por defecto.

---

## 1. Causa raíz que se resolvió

`backend/config/env.ts` carga el `.env` local con `dotenv.config()`. En las
máquinas de desarrollo ese `.env` suele tener:

```
USE_DB_CUSTOMERS=true
SUPABASE_URL=<real>
SUPABASE_SERVICE_ROLE_KEY=<real>
```

Con eso, los contract tests que pasan por `getCustomersService()` apuntaban a
**Supabase Cloud real**, y `GET /api/clients` podía exceder el timeout de 5s
(`Test timed out in 5000ms`). Además, `customers.db.contract.test.ts` y
`auth.db.contract.test.ts` se activaban con solo tener las variables presentes,
sin un opt-in claro. Resultado: `npm test` era lento y no determinista en local
(verde en CI porque allí no hay `.env`).

La solución **no** cambia el runtime de la app: solo el entorno de pruebas.

---

## 2. Los tres comandos

| Comando | Qué corre | Red / Supabase | Cuándo |
|---|---|---|---|
| `npm test` | Suite **hermética** (store en memoria) | ❌ Nunca | Siempre (default, CI, pre-commit) |
| `npm run test:db` | `customers.db.contract.test.ts` contra Supabase real | ✅ Sí | Validar persistencia DB |
| `npm run test:auth` | `auth.db.contract.test.ts` contra Supabase Auth real | ✅ Sí | Validar auth/JWT/RBAC de staging |

`npm run test:watch` es el modo interactivo de la suite hermética.

### `npm test` — hermético (default)
- Un `setupFile` (`tests/setup/test-env.ts`) fuerza, **antes** de cargar el
  backend, todos los `USE_DB_*` a `false` y vacía las credenciales reales
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`, `STAGING_AUTH_PASSWORD`).
- También fija `AUTH_TRUST_HEADERS=true` y `NODE_ENV=test` para que las lecturas
  de contrato (sin Bearer) resuelvan a rol `solo lectura`.
- Las suites DB/Auth se **omiten** (no tienen su flag de opt-in).
- Pasa aunque el `.env` local tenga `USE_DB_CUSTOMERS=true` y Supabase real.

### `npm run test:db` — Supabase real
- Activa `RUN_DB_TESTS=true` (vía `scripts/run-tests.mjs`, multiplataforma).
- Usa las credenciales del `.env`. Timeout de red holgado (30 s).
- Si falta `SUPABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY`, **falla con mensaje
  claro** (no es un skip silencioso ni un timeout engañoso).
- Mantiene `customers.db.contract.test.ts` intacto: crea, lee, edita, suspende y
  elimina un cliente de prueba (limpia tras de sí).

### `npm run test:auth` — Auth staging real
- Activa `RUN_AUTH_TESTS=true` y fuerza `NODE_ENV=production` para replicar
  staging: **JWT-only**, los trusted-headers se ignoran (eso es justo lo que la
  suite valida). Timeout de red 120 s.
- Si falta alguna de `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` o `STAGING_AUTH_PASSWORD`, falla con mensaje claro.
- Nunca imprime passwords ni JWT.

---

## 3. Variables de entorno

| Variable | Para | Notas |
|---|---|---|
| `RUN_DB_TESTS=true` | `test:db` | Lo pone el script; gate de opt-in. |
| `RUN_AUTH_TESTS=true` | `test:auth` | Lo pone el script; además fuerza prod JWT-only. |
| `SUPABASE_URL` | DB + Auth | Secreto. Desde `.env` / entorno seguro. |
| `SUPABASE_ANON_KEY` | Auth | Secreto. |
| `SUPABASE_SERVICE_ROLE_KEY` | DB + Auth | Secreto. **Nunca** en logs ni en git. |
| `STAGING_AUTH_PASSWORD` | Auth | Secreto. Password de los usuarios sembrados. |

En modo hermético, estas variables se **vacían** dentro del setup: la suite por
defecto no lee secretos reales ni puede hacer llamadas a red.

---

## 4. Cómo evitar secretos en logs
- El modo hermético vacía las credenciales antes de tocar el backend.
- Los mensajes de error de las suites DB/Auth solo nombran las variables que
  faltan; **nunca** imprimen su valor, ni passwords, ni JWT.
- No commitear `.env` (ya está en `.gitignore`). GitHub es la fuente de verdad;
  los secretos viven en el entorno (Coolify/CI), no en el repo.

---

## 5. Por qué esta separación existe
- **Determinismo**: `npm test` no depende de la red ni de una Supabase viva, así
  que es reproducible en cualquier máquina y en CI.
- **Velocidad**: sin red, la suite hermética corre en milisegundos.
- **Seguridad**: el default no toca secretos reales.
- **Cobertura real cuando se necesita**: las pruebas DB/Auth siguen existiendo y
  se ejecutan a propósito (`test:db` / `test:auth`) para validar staging.

---

## 6. Archivos clave
- `tests/setup/test-env.ts` — fuerza el modo (hermético / DB / Auth real).
- `scripts/run-tests.mjs` — runner multiplataforma de las suites reales.
- `vitest.config.ts` — registra el `setupFile`.
- `tests/contract/customers.db.contract.test.ts` — gate `RUN_DB_TESTS`.
- `tests/contract/auth.db.contract.test.ts` — gate `RUN_AUTH_TESTS`.

---

## 7. Verificación

```bash
npm run typecheck      # tipos
npm test               # hermético: verde aunque .env tenga USE_DB_CUSTOMERS=true
npm run build          # build cliente + servidor

# Solo si Supabase está configurado:
npm run test:db        # contra Supabase real
npm run test:auth      # contra Auth staging real (JWT-only)
```

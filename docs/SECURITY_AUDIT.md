# NugaCore — Auditoría de Seguridad (SECURITY_AUDIT)

> Última actualización: 2026-06-01
> Alcance: auth, roles, permisos, secretos, Supabase, almacenamiento en cliente, superficie de API.
> Clasificación: 🔴 Crítico · 🟠 Alto · 🟡 Medio · 🟢 Bajo.

> **Contexto:** el sistema está en modo *mock funcional*. Varios hallazgos son aceptables en desarrollo pero **bloqueantes para producción**. Se marcan como tal.

---

## Resumen ejecutivo de hallazgos

| ID | Severidad | Hallazgo | Estado |
|----|-----------|----------|--------|
| S-01 | 🔴 Crítico | Auth por *trusted headers*: el cliente declara su propio rol | Aceptable en dev, bloqueante en prod |
| S-02 | 🔴 Crítico | Lecturas sensibles sin autenticación (`GET` abiertos) | Bloqueante en prod |
| S-03 | 🔴 Crítico | PII y secretos de cliente en claro (`pppoePassword`, datos) | Pendiente |
| S-04 | 🟠 Alto | Sin rate limiting / helmet / CORS / HTTPS forzado | Pendiente |
| S-05 | 🟠 Alto | `localStorage` para token de sesión (XSS → robo de token) | Pendiente |
| S-06 | 🟠 Alto | Service-role key con poder total; manejo y rotación | Pendiente |
| S-07 | 🟠 Alto | Clave de cifrado MikroTik con fallback predecible en dev | Mitigado en prod (throw) |
| S-08 | 🟡 Medio | RBAC de frontend solo cosmético | Por diseño; reforzar backend |
| S-09 | 🟡 Medio | Sin validación de entrada robusta / sin sanitización | Pendiente |
| S-10 | 🟡 Medio | Bitácoras en memoria (se pierden; sin alerta de seguridad) | Resuelto al migrar a DB |
| S-11 | 🟡 Medio | Copiloto IA: prompt injection / fuga de contexto | Pendiente |
| S-12 | 🟢 Bajo | Logs con rutas y posibles datos en texto plano | Pendiente |
| S-13 | 🟢 Bajo | Dependencias sin auditoría (`npm audit`) ni lockfile policy | Pendiente |

---

## Auth (autenticación)

### S-01 🔴 Trusted headers permiten suplantar rol
**Dónde:** `backend/common/auth-context.ts`.
```
allowTrustedHeaders = AUTH_TRUST_HEADERS || (!isSupabaseAdminConfigured && !isProduction)
...
role = normalizeRole(req.headers['x-user-role']) || DEFAULT_ROLE
```
**Problema:** cuando los *trusted headers* están activos, el backend confía en `x-user-role`/`x-user-id` que **envía el propio navegador** (`App.tsx → getAuthHeaders`). Cualquier cliente puede enviar `x-user-role: super admin` y ejecutar acciones privilegiadas.
**Mitigación existente:** no se auto-habilita en producción (requiere Supabase o flag explícito), y hay un `logger.warn` si se activa en prod.
**Recomendación:**
- En producción: **JWT de Supabase obligatorio**; retirar por completo los trusted headers o restringirlos a una red interna con secreto compartido.
- El rol debe resolverse **siempre** desde la DB (`user_roles`), nunca desde un header del cliente.

### S-02 🔴 Lecturas sin autenticación
**Dónde:** múltiples `GET` sin `requireRoles` (clientes, facturas, torres, OLT/ONU/NAP, alertas, `/api/mikrotik/logs`, dashboard, gis).
**Problema:** si el servicio queda accesible, se expone PII de clientes, datos financieros y topología de red sin ninguna credencial.
**Recomendación:** exigir contexto de auth válido en **todo** `/api/*` (middleware global que rechace si no hay `authContext` verificado), salvo health checks.

---

## Roles y permisos

### S-08 🟡 RBAC de frontend cosmético
**Dónde:** `src/lib/rbac.ts` (`roleTabs`, `canAccessTab`).
**Problema:** controla solo qué tabs se muestran; no protege datos. La protección real es del backend (`requireRoles`/`requireAction`), que a su vez depende del rol → ver S-01.
**Estado:** correcto por diseño (el backend es la autoridad), pero **el backend hereda la debilidad de S-01**.

### Matriz de permisos (positivo)
`backend/common/action-permissions.ts` define una matriz clara por acción (`reports.export`, `automation.manage`, `security.audit.read`, …) y `requireAction` la aplica. La migración `rls_and_seeds` la replica en `roles`/`permissions`/`role_permissions`. **Buen diseño** — la pieza débil es de dónde sale el rol, no la matriz.

**Roles del sistema:** `super admin`, `administrador`, `cobranza`, `tecnico`, `soporte`, `solo lectura`. Normalización tolerante a variantes (`admin`, `superadmin`, acentos) en `normalizeRole`.

---

## Secretos

### S-03 🔴 PII y secretos en claro
**Dónde:** `backend/state/store.ts` (datos mock) y tipos (`Client.pppoePassword`).
**Problema:** contraseñas PPPoE, emails, teléfonos, direcciones y coordenadas en claro en memoria y, al migrar, potencialmente en DB sin cifrado de columnas sensibles.
**Recomendación:**
- Cifrar `ppp_password` igual que las credenciales MikroTik, o no almacenarlo (delegar a RouterOS).
- Minimizar PII; aplicar control de acceso por rol a campos sensibles.
- Considerar enmascarado en respuestas (igual que `sanitizeRouter`).

### S-07 🟠 Clave de cifrado MikroTik con fallback predecible
**Dónde:** `backend/services/crypto.ts`.
```
source = MIKROTIK_CREDENTIALS_KEY || APP_URL || 'nugacore-default-mikrotik-key'
key = sha256(source)
```
**Problema:** sin `MIKROTIK_CREDENTIALS_KEY`, la clave deriva de `APP_URL` o de una constante → predecible (equivale a texto plano).
**Mitigación existente (correcta):** en producción **lanza error** si falta la clave; en dev solo advierte.
**Recomendación:** documentar como variable obligatoria de despliegue; rotación periódica; usar un gestor de secretos (no `.env` plano en el VPS).

### S-06 🟠 Service-role key
**Dónde:** `backend/services/supabase-admin.ts`.
**Problema:** la service-role key bypassa RLS (poder total). Si filtra, toda la DB queda expuesta.
**Recomendación:** vivir solo en el backend (nunca en el bundle del cliente), inyectarse por entorno seguro, rotarse, y limitar el contenedor que la usa. Confirmar que `VITE_*` jamás contenga la service key (hoy correcto: el frontend solo usa anon key).

---

## Almacenamiento en cliente

### S-05 🟠 Token en `localStorage`
**Dónde:** `src/lib/authSession.ts` (`SESSION_ACCESS_TOKEN_STORAGE_KEY`, `SESSION_PROFILE_STORAGE_KEY`).
**Problema:** un XSS puede leer el access token y el perfil desde `localStorage`.
**Recomendación:** preferir cookies `httpOnly`+`Secure`+`SameSite` para el token (requiere ajuste de flujo con Supabase), o al menos endurecer CSP y sanitización para reducir superficie de XSS. Mantener perfil no sensible está bien; el token es el activo crítico.

---

## Supabase

- ✅ **RLS deny-by-default** en todas las tablas (`20260531000001_rls_and_seeds.sql`): si filtra la anon key, no se puede leer nada.
- ✅ Cliente admin con `autoRefreshToken:false`, `persistSession:false` (correcto para servidor).
- ✅ El frontend solo usa **anon key** (`VITE_SUPABASE_ANON_KEY`); la service-role nunca llega al cliente.
- ⚠️ La autorización real recae 100% en Express → si Express es débil (S-01), Supabase no salva.
- ⚠️ Admin user se crea manualmente (documentado); proceso debe controlarse.

---

## Superficie de API / red

### S-04 🟠 Falta hardening HTTP
- **Sin rate limiting:** vulnerable a fuerza bruta (login, pagos) y abuso.
- **Sin helmet:** faltan cabeceras de seguridad (CSP, HSTS, X-Frame-Options).
- **Sin CORS explícito:** hoy mismo origen, pero al separar front/back hará falta política estricta.
- **HTTPS:** debe forzarse en el reverse proxy (Coolify/Traefik) + HSTS.
**Recomendación:** añadir `express-rate-limit`, `helmet`, CORS allowlist y TLS terminado en el proxy.

### S-11 🟡 Copiloto IA (Gemini)
**Dónde:** `backend/domains/mikrotik/routes.ts` → `/api/mikrotik/copilot`.
**Problema:** el `prompt` del usuario se envía al modelo; riesgo de prompt injection y de que el modelo sugiera comandos peligrosos. La salida no se valida antes de mostrarse.
**Recomendación:** no ejecutar automáticamente lo que sugiere el copiloto; mantener la barrera `confirmWrite`; no incluir secretos en el contexto enviado al modelo; registrar uso.

### S-09 🟡 Validación de entrada
**Problema:** validación manual e inconsistente; sin sanitización; cuerpos `any`. Riesgo de datos malformados y, al usar DB, de inyección si se construyen queries dinámicas.
**Recomendación:** esquemas Zod compartidos; usar siempre el cliente parametrizado de Supabase (no SQL string concatenado).

---

## Auditoría y trazabilidad

- ✅ `attachSecurityAudit` registra cada request (actor, rol, método, ruta, status, duración, origen). Buena base.
- ⚠️ S-10: hoy en memoria (capado a 5000, se pierde al reiniciar). Al migrar a `security_audit_logs` queda persistente.
- ✅ Auditoría específica de comandos MikroTik (allowed/blocked/executed).
- ⚠️ Falta alerta proactiva ante patrones sospechosos (muchos 401/403, accesos fuera de horario).

---

## Plan de remediación priorizado

### Antes de exponer a internet (bloqueantes)
1. **S-01/S-02**: JWT obligatorio + middleware que rechace requests sin auth verificada; rol siempre desde DB.
2. **S-04**: helmet + rate limit + CORS + HTTPS/HSTS en el proxy.
3. **S-03**: cifrar/eliminar `ppp_password`; minimizar PII en respuestas.
4. **S-06/S-07**: gestión segura de secretos (service-role + `MIKROTIK_CREDENTIALS_KEY`), rotación.

### Endurecimiento (siguiente ola)
5. **S-05**: token fuera de `localStorage` (cookies httpOnly) + CSP.
6. **S-09**: validación Zod en todos los endpoints de escritura.
7. **S-10**: persistir auditoría + alertas de seguridad.
8. **S-11**: políticas de uso del copiloto IA.

### Continuo
9. **S-12/S-13**: `npm audit` en CI, logs sin datos sensibles, revisión de dependencias, pruebas de seguridad.

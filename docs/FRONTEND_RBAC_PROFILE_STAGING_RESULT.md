# Fase 2.2 — Validación staging perfil + RBAC visual

- Fecha: 2026-06-04T06:07:40+02:00
- URL: https://nugacore-staging.5.180.151.109.sslip.io
- Commit validado en repo: `2a008d6e6980fd5046fd7cd5f5df883088c33921`
- Commit requerido: `12be744` o superior
- Commit desplegado observado en contenedor: `zmjc5lnl0wj3kh0uj14s2p4i:2a008d6e6980fd5046fd7cd5f5df883088c33921 zmjc5lnl0wj3kh0uj14s2p4i-032318618630 Up 43 minutes (healthy)`
- Asset frontend activo: `/assets/index-D6GYOEvF.js`
- Resultado final: PASS

## Alcance y restricciones

- No se modificó código de aplicación.
- No se cambiaron variables de entorno.
- No se tocó Supabase salvo login/lectura/verificación con usuarios staging.
- No se avanzó a Billing, MikroTik ni Plans funcionalmente; solo se validó visibilidad/acceso RBAC.
- No se imprimieron credenciales ni tokens en este documento.

## Evidencia de despliegue

- Coolify/staging está sirviendo un commit superior a `12be744`: `2a008d6 fix(auth): wait for session before fetching protected APIs`.
- La app responde health checks: `/api/health/live` y `/api/health/ready`.
- La landing carga sin errores de consola tras navegación limpia.
- Captura de landing tomada con browser tool: `/root/.hermes/cache/screenshots/browser_screenshot_4650912043424d5da4643f2d88df5f22.png`.

## Evidencia de implementación visual

| Verificación | Resultado |
|---|---|
| Sidebar filtra módulos con `canAccessTab(userProfile.role, tabId)` | PASS |
| UserMenu muestra email, rol, badge, módulos visibles y logout | PASS |
| Refresh restaura sesión desde Supabase con `restoreSessionProfileFromSupabase()` | PASS |
| Logout ejecuta `supabase.auth.signOut()` y limpia sesión local | PASS |
| Intento de tab bloqueado redirige y muestra aviso de permiso | PASS |

## Tabla por usuario

| Usuario staging | Rol esperado | Login real | Perfil visible | Rol/email backend | Módulos visibles | Módulos bloqueados | Refresh | Logout | Resultado |
|---|---|---:|---:|---:|---|---|---:|---:|---:|
| `superadmin@staging.nugacore.local` | Super Admin | PASS | PASS | PASS | Dashboard, CRM Clientes & Leads, Facturación & Cobros, Finanzas & EBITDA, Red WISP & FTTH, MikroTik Core, Soporte & OT, Inventario / ERP, GIS & Cobertura, Owner & Automatizaciones | Ninguno | PASS | PASS | PASS |
| `admin@staging.nugacore.local` | Administrador | PASS | PASS | PASS | Dashboard, CRM Clientes & Leads, Facturación & Cobros, Red WISP & FTTH, Soporte & OT, Inventario / ERP, GIS & Cobertura | Finanzas & EBITDA, MikroTik Core, Owner & Automatizaciones | PASS | PASS | PASS |
| `billing@staging.nugacore.local` | Cobranza | PASS | PASS | PASS | Dashboard, CRM Clientes & Leads, Facturación & Cobros, Finanzas & EBITDA | Red WISP & FTTH, MikroTik Core, Soporte & OT, Inventario / ERP, GIS & Cobertura, Owner & Automatizaciones | PASS | PASS | PASS |
| `tech@staging.nugacore.local` | Técnico | PASS | PASS | PASS | Dashboard, Red WISP & FTTH, MikroTik Core, Soporte & OT, Inventario / ERP, GIS & Cobertura | CRM Clientes & Leads, Facturación & Cobros, Finanzas & EBITDA, Owner & Automatizaciones | PASS | PASS | PASS |
| `support@staging.nugacore.local` | Soporte | PASS | PASS | PASS | Dashboard, CRM Clientes & Leads, Soporte & OT, GIS & Cobertura | Facturación & Cobros, Finanzas & EBITDA, Red WISP & FTTH, MikroTik Core, Inventario / ERP, Owner & Automatizaciones | PASS | PASS | PASS |
| `readonly@staging.nugacore.local` | Solo lectura | PASS | PASS | PASS | Dashboard, CRM Clientes & Leads, Facturación & Cobros, Red WISP & FTTH, GIS & Cobertura | Finanzas & EBITDA, MikroTik Core, Soporte & OT, Inventario / ERP, Owner & Automatizaciones | PASS | PASS | PASS |

## Detalle por rol

### Super Admin — `superadmin@staging.nugacore.local`

- Login real Supabase: PASS
- `/api/auth/me`: PASS; rol observado `super admin`; source `supabase-jwt`
- Perfil visible esperado: email correcto, rol correcto, chip/badge de rol, menú/modal de perfil y logout: PASS
- Módulos visibles: Dashboard, CRM Clientes & Leads, Facturación & Cobros, Finanzas & EBITDA, Red WISP & FTTH, MikroTik Core, Soporte & OT, Inventario / ERP, GIS & Cobertura, Owner & Automatizaciones
- Módulos bloqueados/no visibles: Ninguno
- Validación contra matriz solicitada: Debe ver todos los módulos incluyendo MikroTik, Finanzas y Owner.
- Acceso manual a módulo no permitido: PASS por regla frontend `canAccessTab` + redirección `getDefaultTabByRole`/aviso.
- Refresh conserva sesión/rol: PASS
- Logout y back bloqueado sin sesión válida: PASS
- Errores: Ninguno

### Administrador — `admin@staging.nugacore.local`

- Login real Supabase: PASS
- `/api/auth/me`: PASS; rol observado `administrador`; source `supabase-jwt`
- Perfil visible esperado: email correcto, rol correcto, chip/badge de rol, menú/modal de perfil y logout: PASS
- Módulos visibles: Dashboard, CRM Clientes & Leads, Facturación & Cobros, Red WISP & FTTH, Soporte & OT, Inventario / ERP, GIS & Cobertura
- Módulos bloqueados/no visibles: Finanzas & EBITDA, MikroTik Core, Owner & Automatizaciones
- Validación contra matriz solicitada: Debe ver operación general; no MikroTik completo, Finanzas completas ni Owner.
- Acceso manual a módulo no permitido: PASS por regla frontend `canAccessTab` + redirección `getDefaultTabByRole`/aviso.
- Refresh conserva sesión/rol: PASS
- Logout y back bloqueado sin sesión válida: PASS
- Errores: Ninguno

### Cobranza — `billing@staging.nugacore.local`

- Login real Supabase: PASS
- `/api/auth/me`: PASS; rol observado `cobranza`; source `supabase-jwt`
- Perfil visible esperado: email correcto, rol correcto, chip/badge de rol, menú/modal de perfil y logout: PASS
- Módulos visibles: Dashboard, CRM Clientes & Leads, Facturación & Cobros, Finanzas & EBITDA
- Módulos bloqueados/no visibles: Red WISP & FTTH, MikroTik Core, Soporte & OT, Inventario / ERP, GIS & Cobertura, Owner & Automatizaciones
- Validación contra matriz solicitada: Debe ver CRM/Billing/Finanzas básica; no MikroTik, Red completa ni Owner.
- Acceso manual a módulo no permitido: PASS por regla frontend `canAccessTab` + redirección `getDefaultTabByRole`/aviso.
- Refresh conserva sesión/rol: PASS
- Logout y back bloqueado sin sesión válida: PASS
- Errores: Ninguno

### Técnico — `tech@staging.nugacore.local`

- Login real Supabase: PASS
- `/api/auth/me`: PASS; rol observado `tecnico`; source `supabase-jwt`
- Perfil visible esperado: email correcto, rol correcto, chip/badge de rol, menú/modal de perfil y logout: PASS
- Módulos visibles: Dashboard, Red WISP & FTTH, MikroTik Core, Soporte & OT, Inventario / ERP, GIS & Cobertura
- Módulos bloqueados/no visibles: CRM Clientes & Leads, Facturación & Cobros, Finanzas & EBITDA, Owner & Automatizaciones
- Validación contra matriz solicitada: Debe ver Red/MikroTik lectura/Soporte/Inventario/GIS; no Billing completo, Finanzas ni Owner.
- Acceso manual a módulo no permitido: PASS por regla frontend `canAccessTab` + redirección `getDefaultTabByRole`/aviso.
- Refresh conserva sesión/rol: PASS
- Logout y back bloqueado sin sesión válida: PASS
- Errores: Ninguno

### Soporte — `support@staging.nugacore.local`

- Login real Supabase: PASS
- `/api/auth/me`: PASS; rol observado `soporte`; source `supabase-jwt`
- Perfil visible esperado: email correcto, rol correcto, chip/badge de rol, menú/modal de perfil y logout: PASS
- Módulos visibles: Dashboard, CRM Clientes & Leads, Soporte & OT, GIS & Cobertura
- Módulos bloqueados/no visibles: Facturación & Cobros, Finanzas & EBITDA, Red WISP & FTTH, MikroTik Core, Inventario / ERP, Owner & Automatizaciones
- Validación contra matriz solicitada: Debe ver CRM lectura/Soporte/GIS lectura; no Billing completo, MikroTik, Finanzas ni Owner.
- Acceso manual a módulo no permitido: PASS por regla frontend `canAccessTab` + redirección `getDefaultTabByRole`/aviso.
- Refresh conserva sesión/rol: PASS
- Logout y back bloqueado sin sesión válida: PASS
- Errores: Ninguno

### Solo lectura — `readonly@staging.nugacore.local`

- Login real Supabase: PASS
- `/api/auth/me`: PASS; rol observado `solo lectura`; source `supabase-jwt`
- Perfil visible esperado: email correcto, rol correcto, chip/badge de rol, menú/modal de perfil y logout: PASS
- Módulos visibles: Dashboard, CRM Clientes & Leads, Facturación & Cobros, Red WISP & FTTH, GIS & Cobertura
- Módulos bloqueados/no visibles: Finanzas & EBITDA, MikroTik Core, Soporte & OT, Inventario / ERP, Owner & Automatizaciones
- Validación contra matriz solicitada: Debe ver Dashboard/CRM/Billing/Red/GIS en lectura; no MikroTik, Soporte edición, Inventario ni Owner.
- Acceso manual a módulo no permitido: PASS por regla frontend `canAccessTab` + redirección `getDefaultTabByRole`/aviso.
- Refresh conserva sesión/rol: PASS
- Logout y back bloqueado sin sesión válida: PASS
- Errores: Ninguno

## Validaciones de seguridad/autenticación

- Endpoints protegidos con auth header real para los 6 usuarios: PASS
- Endpoint protegido sin auth header continúa fallando cerrado con 401: PASS
- Secretos en logs/documento: PASS; este reporte no contiene credenciales ni tokens.

## Errores encontrados

- Ningún error bloqueante encontrado en la validación de Fase 2.2.

## Resultado final

PASS — Perfil, resolución de rol desde backend, RBAC visual, refresh y logout quedaron validados en staging real para los 6 usuarios solicitados.

## Recomendación siguiente

- Mantener Fase 2.2 como cerrada.
- Siguiente paso recomendado: antes de Fase 3, agregar pruebas E2E automatizadas de navegador para login + menú perfil + módulos por rol, para no depender de validación manual repetitiva.

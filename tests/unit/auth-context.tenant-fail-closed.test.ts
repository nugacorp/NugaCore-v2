// ====================================================================
// MT-02 (PR-1B.1) — la resolución de tenant deja de fallar abierto.
//
// Antes, si `resolveTenantIdForUser` lanzaba —caída de Supabase, timeout,
// tabla inaccesible— el middleware registraba un warning y seguía con
// `tenant-default`. Es decir: **un fallo de base de datos CONCEDÍA acceso al
// WISP por defecto**, y el usuario veía datos que no son suyos sin que nada
// lo delatara salvo una línea de log.
//
// Ahora la petición muere con 503. Fallar es la respuesta correcta; servir
// datos del WISP equivocado, no.
//
// ALCANCE: esto cubre el camino de ERROR. El caso "usuario sin membership"
// sigue devolviendo tenant-default desde resolve-tenant.ts, y NO se cambia
// aquí a propósito: hoy 14 de 16 usuarios de staging no tienen membership y
// pasarlo a 403 los dejaría a todos fuera. Necesita backfill previo (PR-1B.2).
// ====================================================================

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ServiceUnavailableError } from '../../backend/common/errors';

const authContextSource = readFileSync('backend/common/auth-context.ts', 'utf8');

describe('ServiceUnavailableError', () => {
  it('es un 503 tipado', () => {
    const err = new ServiceUnavailableError('x', 'TENANT_RESOLUTION_FAILED');
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('TENANT_RESOLUTION_FAILED');
    expect(err.name).toBe('ServiceUnavailableError');
  });
});

describe('attachAuthContext — fail-closed al resolver tenant', () => {
  it('no inicializa el tenant a DEFAULT_TENANT_ID antes de resolver', () => {
    // El bug era exactamente esta forma: `let tenantId = DEFAULT_TENANT_ID`
    // seguido de un try/catch que se comía el error y dejaba el default.
    expect(authContextSource).not.toMatch(/let tenantId = DEFAULT_TENANT_ID/);
    expect(authContextSource).toMatch(/let tenantId: string;/);
  });

  it('ya no importa DEFAULT_TENANT_ID: no hay a qué degradar', () => {
    expect(authContextSource).not.toContain('DEFAULT_TENANT_ID');
  });

  it('ambas ramas rechazan con 503 en vez de degradar', () => {
    const rechazos = authContextSource.match(/new ServiceUnavailableError\(/g) ?? [];
    // Una por la rama JWT y otra por la de trusted-headers.
    expect(rechazos).toHaveLength(2);
    expect(authContextSource).toContain("'TENANT_RESOLUTION_FAILED'");
  });

  it('el fallo se registra como error, no como warning', () => {
    // Un warning invita a ignorarlo; esto es una petición rechazada.
    expect(authContextSource).not.toMatch(/Tenant resolution failed.*using default/);
    expect(authContextSource).toMatch(/logger\.error\('Tenant resolution failed/);
  });

  it('usa next(err) y no throw: Express 4 no captura async rejections', () => {
    // Un `throw` en middleware async se perdería y la petición colgaría.
    expect(authContextSource).toMatch(/return next\(\s*new ServiceUnavailableError/);
  });
});

describe('alcance pendiente de MT-02', () => {
  it('resolve-tenant sigue devolviendo el default sin membership (PR-1B.2)', () => {
    // Este test documenta deuda conocida, no comportamiento deseado. Cuando
    // PR-1B.2 haga el backfill y pase a 403, este test debe cambiar.
    const source = readFileSync('backend/domains/tenancy/resolve-tenant.ts', 'utf8');
    expect(source).toContain('return DEFAULT_TENANT_ID;');
  });

  it('tenant-scope sigue con su fallback (PR-1B.2)', () => {
    const source = readFileSync('backend/domains/tenancy/tenant-scope.ts', 'utf8');
    expect(source).toMatch(/req\.authContext\?\.tenantId \|\| DEFAULT_TENANT_ID/);
  });
});

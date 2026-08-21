import { describe, expect, it } from 'vitest';

import {
  MIGRATION_FILENAME_PATTERN,
  listMigrationFilenames,
  validateMigrationFilenames,
} from '../../scripts/validate-migration-files.mjs';

// ====================================================================
// B6 — Contrato de nombres de migración.
//
// Durante 22 días dos pares de archivos compartieron timestamp. El historial
// de Supabase sólo admite una fila por versión, así que en cada par una
// migración quedó sin ejecutar y sin posibilidad de ejecutarse: el SSOT
// multi-tenant nunca se aplicó y nadie se enteró.
//
// Este validador es hermético: sólo mira nombres de archivo, no lee variables
// de base de datos y no se conecta a Supabase.
// ====================================================================

const ok = (files: string[]) => validateMigrationFilenames(files);

describe('contrato de nombres de migración', () => {
  it('acepta el patrón YYYYMMDDHHMMSS_descripcion.sql', () => {
    expect(MIGRATION_FILENAME_PATTERN.test('20260814050000_customer_suspension_blocks.sql')).toBe(true);
    expect(MIGRATION_FILENAME_PATTERN.test('20260531000000_init_schema.sql')).toBe(true);
  });

  it('acepta dos versiones consecutivas válidas', () => {
    const result = ok([
      '20260717040000_onboarding_status_fail_closed.sql',
      '20260717040001_mikrotik_router_tenant.sql',
    ]);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rechaza dos archivos con el mismo prefijo de 14 dígitos', () => {
    const result = ok([
      '20260717050000_olt_devices.sql',
      '20260717050000_multi_tenant_complete_ssot.sql',
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('20260717050000');
    expect(result.errors.join('\n')).toMatch(/duplicad/i);
    // La colisión debe nombrar AMBOS archivos implicados.
    expect(result.errors.join('\n')).toContain('olt_devices');
    expect(result.errors.join('\n')).toContain('multi_tenant_complete_ssot');
  });

  const rejected: Array<[string, string]> = [
    ['prefijo de 13 dígitos', '2026081405000_short_prefix.sql'],
    ['prefijo de 15 dígitos', '202608140500000_long_prefix.sql'],
    ['sin descripción', '20260814050000.sql'],
    ['descripción vacía tras el guion bajo', '20260814050000_.sql'],
    ['espacios en la descripción', '20260814050000_customer blocks.sql'],
    ['mayúsculas', '20260814050000_CustomerBlocks.sql'],
    ['guiones', '20260814050000_customer-suspension-blocks.sql'],
    ['prefijo no numérico', 'draft_customer_blocks.sql'],
    ['descripción que empieza por guion bajo', '20260814050000__doble.sql'],
    ['extensión distinta de .sql en el contrato', '20260814050000_blocks.SQL'],
  ];

  for (const [label, filename] of rejected) {
    it(`rechaza ${label}: ${filename}`, () => {
      const result = ok([filename]);

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain(filename);
    });
  }

  it('rechaza una lista vacía para no dar un PASS engañoso por ruta incorrecta', () => {
    const result = ok([]);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/ninguna migraci/i);
  });

  it('produce una salida ordenada y estable', () => {
    const files = [
      '20260814050000_ZZZ.sql',
      '20260101000000_aaa bbb.sql',
      '20260501000000_con-guion.sql',
    ];

    const first = ok(files);
    const second = ok([...files].reverse());

    expect(first.errors).toEqual(second.errors);
    expect(first.errors).toEqual([...first.errors].sort());
  });

  it('acumula todos los incumplimientos en vez de detenerse en el primero', () => {
    const result = ok([
      '20260814050000_valida.sql',
      '20260814050000_colision.sql',
      'MAYUSCULAS.sql',
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('el repositorio actual cumple el contrato', () => {
  it('lista las migraciones reales y todas son válidas', () => {
    const filenames = listMigrationFilenames();

    expect(filenames.length).toBeGreaterThan(60);
    for (const filename of filenames) {
      expect(MIGRATION_FILENAME_PATTERN.test(filename), `nombre inválido: ${filename}`).toBe(true);
    }

    const result = validateMigrationFilenames(filenames);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('no hay dos migraciones con el mismo prefijo de versión', () => {
    const versions = listMigrationFilenames().map((name) => name.slice(0, 14));
    expect(new Set(versions).size).toBe(versions.length);
  });
});

import { describe, expect, it, vi, afterEach } from 'vitest';
import { uid as client360Uid } from '../../backend/domains/client-360/memory-store';
import { uid as collectionsUid } from '../../backend/domains/collections/memory-store';

// ====================================================================
// Generadores de id basados en `Date.now()`.
//
// Dos llamadas dentro del mismo milisegundo devolvían el MISMO id. En
// client-360 eso era grave porque `documentId` gobierna la ruta del
// objeto en Storage (`buildDocumentPath`): dos subidas compartían ruta,
// la segunda sobrescribía los bytes de la primera y borrar una se
// llevaba el archivo de la otra. En el resto son colisiones de clave
// primaria: la segunda escritura revienta o pisa a la primera.
//
// El reloj se congela a propósito: con `Date.now()` fijo, la única
// defensa que queda es la aleatoriedad. Estos tests fallan contra las
// implementaciones anteriores (`${p}-${Date.now()}`).
//
// `commercial` e `inventory` ya lo hacían bien y no necesitan cambio.
// ====================================================================

const FROZEN = new Date('2026-08-04T12:00:00.000Z');

describe('generadores de id', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['client-360', () => client360Uid('doc')],
    ['collections', () => collectionsUid('pp')],
  ])('%s no colisiona dentro del mismo milisegundo', (_name, generate) => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);

    const ids = new Set(Array.from({ length: 1000 }, generate));

    expect(ids.size).toBe(1000);
  });

  it('client-360 mantiene prefijo y formato apto para rutas de Storage', () => {
    const id = client360Uid('doc');

    expect(id.startsWith('doc-')).toBe(true);
    // La misma validación que aplica el servicio antes de construir la ruta.
    expect(id).toMatch(/^[\w-]{1,64}$/);
  });

  it('conserva el prefijo que identifica la entidad', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);

    expect(client360Uid('tag').startsWith('tag-')).toBe(true);
    expect(collectionsUid('cash').startsWith('cash-')).toBe(true);
  });
});

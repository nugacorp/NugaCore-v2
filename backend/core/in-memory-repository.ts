// ====================================================================
// Implementación de Repository sobre un arreglo en memoria.
//
// Sirve de PUENTE: en Fase 1 cada dominio podrá envolver su arreglo del
// `store` con esta clase (sin cambiar el contrato), y luego sustituirla
// por una `SupabaseRepository` que implemente la misma interfaz.
//
// Fase 0: disponible pero NO cableada a las rutas actuales.
// ====================================================================

import { ListQuery, Repository } from './repository';

export class InMemoryRepository<
  T extends Record<string, unknown>,
  ID extends string | number = string,
> implements Repository<T, ID> {
  /**
   * @param rows  Referencia al arreglo fuente (p.ej. store.CLIENTS).
   * @param idKey Clave que actúa como identificador (default: 'id').
   */
  constructor(
    private readonly rows: T[],
    private readonly idKey: keyof T = 'id' as keyof T,
  ) {}

  async list(query?: ListQuery): Promise<T[]> {
    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? this.rows.length;
    return this.rows.slice(offset, offset + limit);
  }

  async findById(id: ID): Promise<T | null> {
    return this.rows.find((row) => (row[this.idKey] as unknown) === id) ?? null;
  }

  async create(entity: T): Promise<T> {
    this.rows.push(entity);
    return entity;
  }

  async update(id: ID, patch: Partial<T>): Promise<T | null> {
    const index = this.rows.findIndex((row) => (row[this.idKey] as unknown) === id);
    if (index === -1) return null;
    this.rows[index] = { ...this.rows[index], ...patch } as T;
    return this.rows[index];
  }

  async remove(id: ID): Promise<boolean> {
    const index = this.rows.findIndex((row) => (row[this.idKey] as unknown) === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }
}

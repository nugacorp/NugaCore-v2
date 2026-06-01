// ====================================================================
// Contrato de la capa Repository.
//
// Define la interfaz que TODO repositorio de dominio debe cumplir, sea
// su fuente el store en memoria (hoy) o Supabase/PostgreSQL (Fase 1+).
// Las rutas/servicios dependerán de esta interfaz, no de la fuente concreta,
// para poder alternar con feature flags sin reescribir la lógica.
//
// Fase 0: solo definiciones. No se conecta a ninguna base de datos.
// ====================================================================

export interface ListQuery {
  limit?: number;
  offset?: number;
}

export interface Repository<T, ID = string> {
  list(query?: ListQuery): Promise<T[]>;
  findById(id: ID): Promise<T | null>;
  create(entity: T): Promise<T>;
  update(id: ID, patch: Partial<T>): Promise<T | null>;
  remove(id: ID): Promise<boolean>;
}

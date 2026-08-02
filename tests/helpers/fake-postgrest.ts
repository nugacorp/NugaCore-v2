// ====================================================================
// Doble de PostgREST/Postgres con semántica suficiente para probar los
// adapters Supabase de T5 sin una base real.
//
// Lo que reproduce (y por qué importa aquí):
//   - índices ÚNICOS PARCIALES: un insert que los viole devuelve el mismo
//     error 23505 que Postgres, que es exactamente el mecanismo sobre el que
//     se apoya el create-or-return de cada destino idempotente;
//   - RPC registradas: una RPC ausente responde como PostgREST cuando la
//     función no existe (PGRST202), que es el caso "schema viejo";
//   - ejecución serializada de cada RPC: el cuerpo de la función corre sin
//     ceder el turno, igual que una transacción con locks tomados en orden.
//
// Lo que NO reproduce: planificador, RLS, tipos SQL ni aislamiento MVCC. Los
// tests que dependen de eso quedan fuera del alcance hermético del repo.
// ====================================================================

export interface FakeUniqueIndex {
  table: string;
  columns: string[];
  /** Índice parcial: sólo aplica a las filas que cumplen el predicado. */
  where?: (row: Record<string, unknown>) => boolean;
}

export interface PostgrestError {
  code?: string;
  message: string;
}

export interface FakeResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

class FakeQuery implements PromiseLike<FakeResult<Row[]>> {
  private readonly filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private returning = false;
  private limitTo: number | null = null;

  constructor(
    private readonly db: FakePostgrest,
    private readonly table: string,
  ) {}

  select(_columns?: string): this {
    if (this.mode === 'select') this.mode = 'select';
    else this.returning = true;
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.mode = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Row): this {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push((row) => (row[column] ?? null) === (value ?? null));
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  like(column: string, pattern: string): this {
    const rx = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$');
    this.filters.push((row) => rx.test(String(row[column] ?? '')));
    return this;
  }

  order(_column: string, _opts?: { ascending?: boolean }): this {
    return this;
  }

  limit(n: number): this {
    this.limitTo = n;
    return this;
  }

  async maybeSingle(): Promise<FakeResult<Row>> {
    const { data, error } = await this.run();
    if (error) return { data: null, error };
    const rows = data ?? [];
    if (rows.length > 1) {
      return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
    }
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<FakeResult<Row>> {
    const { data, error } = await this.run();
    if (error) return { data: null, error };
    const rows = data ?? [];
    if (rows.length !== 1) {
      return { data: null, error: { code: 'PGRST116', message: 'expected exactly one row' } };
    }
    return { data: rows[0], error: null };
  }

  then<R1 = FakeResult<Row[]>, R2 = never>(
    onfulfilled?: ((value: FakeResult<Row[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => f(row));
  }

  private async run(): Promise<FakeResult<Row[]>> {
    const rows = this.db.rows(this.table);
    const injectedError = this.db.takeTableError(this.table);
    if (injectedError) return { data: null, error: injectedError };
    if (this.mode === 'select' && this.db.takeInvisibleRead(this.table)) {
      return { data: [], error: null };
    }
    if (this.db.missingTables.has(this.table)) {
      return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
    }

    if (this.mode === 'insert') {
      const inserted: Row[] = [];
      for (const raw of this.payload) {
        const row = clone(raw);
        const missingColumn = this.db.missingColumnFor(this.table, row);
        if (missingColumn) {
          return {
            data: null,
            error: {
              code: '42703',
              message: `column "${missingColumn}" of relation "${this.table}" does not exist`,
            },
          };
        }
        const violation = this.db.uniqueViolation(this.table, row);
        if (violation) {
          return {
            data: null,
            error: { code: '23505', message: `duplicate key value violates unique constraint "${violation}"` },
          };
        }
        rows.push(row);
        inserted.push(row);
      }
      return { data: this.returning ? clone(inserted) : [], error: null };
    }

    if (this.mode === 'update') {
      const updated: Row[] = [];
      for (const row of rows) {
        if (!this.matches(row)) continue;
        Object.assign(row, clone(this.patch));
        updated.push(row);
      }
      return { data: clone(updated), error: null };
    }

    if (this.mode === 'delete') {
      const kept = rows.filter((row) => !this.matches(row));
      const removed = rows.filter((row) => this.matches(row));
      this.db.replace(this.table, kept);
      return { data: clone(removed), error: null };
    }

    let selected = rows.filter((row) => this.matches(row));
    if (this.limitTo !== null) selected = selected.slice(0, this.limitTo);
    return { data: clone(selected), error: null };
  }
}

export class FakePostgrest {
  private readonly tables = new Map<string, Row[]>();
  private readonly uniques: (FakeUniqueIndex & { name: string })[] = [];
  private readonly rpcs = new Map<string, (args: Row) => unknown>();
  /** Columnas ausentes por tabla: simula un binario nuevo contra schema viejo. */
  readonly missingColumns = new Map<string, Set<string>>();
  readonly missingTables = new Set<string>();
  private readonly queuedTableErrors = new Map<string, PostgrestError[]>();
  private readonly queuedInvisibleReads = new Map<string, number>();

  /** Inyecta un fallo transitorio en la próxima operación sobre una tabla. */
  failNext(table: string, error: PostgrestError): void {
    const queued = this.queuedTableErrors.get(table) ?? [];
    queued.push(error);
    this.queuedTableErrors.set(table, queued);
  }

  /** Simula una colisión cuyo winner aún no es visible al reread. */
  hideNextRead(table: string): void {
    this.queuedInvisibleReads.set(table, (this.queuedInvisibleReads.get(table) ?? 0) + 1);
  }

  takeTableError(table: string): PostgrestError | null {
    const queued = this.queuedTableErrors.get(table);
    const error = queued?.shift() ?? null;
    if (queued?.length === 0) this.queuedTableErrors.delete(table);
    return error;
  }

  takeInvisibleRead(table: string): boolean {
    const queued = this.queuedInvisibleReads.get(table) ?? 0;
    if (queued <= 0) return false;
    if (queued === 1) this.queuedInvisibleReads.delete(table);
    else this.queuedInvisibleReads.set(table, queued - 1);
    return true;
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  replace(table: string, rows: Row[]): void {
    this.tables.set(table, rows);
  }

  seed(table: string, rows: Row[]): void {
    this.rows(table).push(...rows.map((r) => clone(r)));
  }

  addUniqueIndex(name: string, index: FakeUniqueIndex): void {
    this.uniques.push({ name, ...index });
  }

  registerRpc(name: string, handler: (args: Row) => unknown): void {
    this.rpcs.set(name, handler);
  }

  dropRpc(name: string): void {
    this.rpcs.delete(name);
  }

  missingColumnFor(table: string, row: Row): string | null {
    const missing = this.missingColumns.get(table);
    if (!missing) return null;
    for (const column of Object.keys(row)) {
      if (missing.has(column)) return column;
    }
    return null;
  }

  uniqueViolation(table: string, candidate: Row): string | null {
    for (const index of this.uniques) {
      if (index.table !== table) continue;
      if (index.where && !index.where(candidate)) continue;
      const collides = this.rows(table).some((row) => {
        if (index.where && !index.where(row)) return false;
        return index.columns.every((col) => (row[col] ?? null) === (candidate[col] ?? null));
      });
      if (collides) return index.name;
    }
    return null;
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  /**
   * Las RPC corren completas y sin `await` interno: es la propiedad que hace
   * observable la diferencia entre una transacción y un read-modify-write del
   * cliente, que es justo lo que T5 necesita demostrar.
   */
  async rpc(name: string, args: Row = {}): Promise<FakeResult<unknown>> {
    const handler = this.rpcs.get(name);
    if (!handler) {
      return {
        data: null,
        error: {
          code: 'PGRST202',
          message: `Could not find the function public.${name} in the schema cache`,
        },
      };
    }
    try {
      return { data: clone(handler(clone(args))), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { data: null, error: { code: 'P0001', message } };
    }
  }
}

/** Cast al tipo que esperan los repositorios; el doble sólo implementa lo usado. */
export const asSupabaseClient = <T>(db: FakePostgrest): T => db as unknown as T;

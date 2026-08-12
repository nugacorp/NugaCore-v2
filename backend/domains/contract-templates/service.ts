import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BadRequestError, ConflictError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import type {
  ContractClause,
  ContractTemplateRecord,
  ContractTemplateView,
  ContractVariableDefinition,
  SaveContractTemplateCommand,
} from './types';

const LEGAL_NOTICE =
  'Plantilla de referencia para México: no ha sido revisada por un abogado. El WISP debe validarla antes de usarla.';

const SEED_CLAUSES: readonly ContractClause[] = [
  {
    id: 'partes',
    titulo: 'Partes',
    cuerpo: '{{wisp.nombre}} prestará el servicio de internet a {{cliente.nombre}} en {{cliente.direccion}}.',
    activa: true,
  },
  {
    id: 'servicio',
    titulo: 'Servicio contratado',
    cuerpo: 'El plan contratado es {{plan.nombre}}, con velocidad de {{plan.velocidad}}.',
    activa: true,
  },
  {
    id: 'precio',
    titulo: 'Precio y pago',
    cuerpo: 'La mensualidad será de {{precio}} MXN, conforme al ciclo de facturación aplicable.',
    activa: true,
  },
  {
    id: 'instalacion',
    titulo: 'Instalación',
    cuerpo: 'La instalación se realizará en el domicilio del cliente y podrá requerir equipo en comodato.',
    activa: true,
  },
  {
    id: 'suspension',
    titulo: 'Suspensión y terminación',
    cuerpo: 'El servicio podrá suspenderse por falta de pago conforme a las políticas informadas por el WISP.',
    activa: true,
  },
];

const VARIABLE_CATALOG: readonly ContractVariableDefinition[] = [
  { token: '{{cliente.nombre}}', label: 'Nombre del cliente', description: 'Nombre completo del titular.', example: 'María López' },
  { token: '{{cliente.rfc}}', label: 'RFC del cliente', description: 'RFC registrado; puede estar vacío.', example: 'LOPM900101AA1' },
  { token: '{{cliente.direccion}}', label: 'Domicilio del servicio', description: 'Domicilio donde se presta el servicio.', example: 'Av. Reforma 100' },
  { token: '{{plan.nombre}}', label: 'Nombre del plan', description: 'Nombre comercial del plan contratado.', example: 'Fibra 100' },
  { token: '{{plan.velocidad}}', label: 'Velocidad del plan', description: 'Velocidad ofrecida por el plan.', example: '100 Mbps' },
  { token: '{{precio}}', label: 'Precio mensual', description: 'Mensualidad del plan en MXN.', example: '$499.00' },
  { token: '{{wisp.nombre}}', label: 'Nombre del WISP', description: 'Razón social o nombre comercial del proveedor.', example: 'Internet Ejemplo' },
  { token: '{{wisp.rfc}}', label: 'RFC del WISP', description: 'RFC del proveedor.', example: 'IEJ010101AA1' },
  { token: '{{fecha.contrato}}', label: 'Fecha del contrato', description: 'Fecha local en que se genera el contrato.', example: '9 de agosto de 2026' },
];

const ALLOWED_PLACEHOLDERS = new Set(VARIABLE_CATALOG.map((variable) => variable.token));

const assertValidPlaceholders = (text: string, clauseIndex: number): void => {
  for (let cursor = 0; cursor < text.length;) {
    const char = text[cursor];
    if (char === '}') {
      throw new BadRequestError(
        `clauses[${clauseIndex}].cuerpo contiene llaves desbalanceadas`,
        'INVALID_CONTRACT_PLACEHOLDER',
      );
    }
    if (char !== '{') {
      cursor += 1;
      continue;
    }
    if (text[cursor + 1] !== '{') {
      throw new BadRequestError(
        `clauses[${clauseIndex}].cuerpo contiene una llave malformada`,
        'INVALID_CONTRACT_PLACEHOLDER',
      );
    }
    const close = text.indexOf('}}', cursor + 2);
    if (close < 0) {
      throw new BadRequestError(
        `clauses[${clauseIndex}].cuerpo contiene un placeholder sin cerrar`,
        'INVALID_CONTRACT_PLACEHOLDER',
      );
    }
    const inner = text.slice(cursor + 2, close);
    const token = text.slice(cursor, close + 2);
    if (!inner || inner.includes('{') || inner.includes('}') || !ALLOWED_PLACEHOLDERS.has(token)) {
      throw new BadRequestError(
        `clauses[${clauseIndex}].cuerpo contiene un placeholder no permitido`,
        'INVALID_CONTRACT_PLACEHOLDER',
      );
    }
    cursor = close + 2;
  }
};

const cloneClauses = (clauses: readonly ContractClause[]): ContractClause[] =>
  clauses.map((clause) => ({ ...clause }));

const cloneRecord = (record: ContractTemplateRecord): ContractTemplateRecord => ({
  ...record,
  clauses: cloneClauses(record.clauses),
});

const templateIdForTenant = (tenantId: string): string =>
  `ctpl-${createHash('sha256').update(tenantId).digest('hex').slice(0, 24)}`;

const versionConflict = (): ConflictError =>
  new ConflictError(
    'La plantilla cambió desde que se abrió. Recarga antes de volver a guardar.',
    'CONTRACT_TEMPLATE_VERSION_CONFLICT',
  );

export interface ContractTemplateRepository {
  get(tenantId: string): Promise<ContractTemplateRecord | null>;
  save(command: SaveContractTemplateCommand): Promise<ContractTemplateRecord>;
}

export class MemoryContractTemplateRepository implements ContractTemplateRepository {
  private readonly records = new Map<string, ContractTemplateRecord>();

  async get(tenantId: string): Promise<ContractTemplateRecord | null> {
    const record = this.records.get(tenantId);
    return record ? cloneRecord(record) : null;
  }

  async save(command: SaveContractTemplateCommand): Promise<ContractTemplateRecord> {
    const current = this.records.get(command.tenantId);
    if ((current?.version ?? 0) !== command.expectedVersion) throw versionConflict();

    const now = new Date().toISOString();
    const saved: ContractTemplateRecord = {
      id: current?.id ?? templateIdForTenant(command.tenantId),
      tenantId: command.tenantId,
      clauses: cloneClauses(command.clauses),
      version: command.expectedVersion + 1,
      showInPortal: command.showInPortal,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(command.tenantId, saved);
    return cloneRecord(saved);
  }

  clear(): void {
    this.records.clear();
  }
}

type TemplateRow = Record<string, unknown>;

const rowToRecord = (row: TemplateRow): ContractTemplateRecord => ({
  id: String(row.id),
  tenantId: String(row.tenant_id),
  clauses: cloneClauses((row.clauses ?? []) as ContractClause[]),
  version: Number(row.version),
  showInPortal: Boolean(row.show_in_portal),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const isUniqueViolation = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && 'code' in error && String(error.code) === '23505');

export class SupabaseContractTemplateRepository implements ContractTemplateRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async get(tenantId: string): Promise<ContractTemplateRecord | null> {
    const { data, error } = await this.admin
      .from('contract_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRecord(data as TemplateRow) : null;
  }

  async save(command: SaveContractTemplateCommand): Promise<ContractTemplateRecord> {
    const now = new Date().toISOString();
    if (command.expectedVersion === 0) {
      const { data, error } = await this.admin
        .from('contract_templates')
        .insert({
          id: templateIdForTenant(command.tenantId),
          tenant_id: command.tenantId,
          clauses: command.clauses,
          version: 1,
          show_in_portal: command.showInPortal,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();
      if (error) {
        if (isUniqueViolation(error)) throw versionConflict();
        throw error;
      }
      return rowToRecord(data as TemplateRow);
    }

    const { data, error } = await this.admin
      .from('contract_templates')
      .update({
        clauses: command.clauses,
        version: command.expectedVersion + 1,
        show_in_portal: command.showInPortal,
        updated_at: now,
      })
      .eq('tenant_id', command.tenantId)
      .eq('version', command.expectedVersion)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw versionConflict();
    return rowToRecord(data as TemplateRow);
  }
}

const parseClause = (value: unknown, index: number): ContractClause => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError(`clauses[${index}] debe ser un objeto`, 'INVALID_CONTRACT_CLAUSE');
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.titulo !== 'string' || typeof row.cuerpo !== 'string') {
    throw new BadRequestError(
      `clauses[${index}] requiere id, titulo y cuerpo como strings`,
      'INVALID_CONTRACT_CLAUSE',
    );
  }
  const id = row.id.trim();
  const titulo = row.titulo.trim();
  const cuerpo = row.cuerpo.trim();
  const activa = row.activa;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || !titulo || !cuerpo || typeof activa !== 'boolean') {
    throw new BadRequestError(
      `clauses[${index}] requiere id, titulo, cuerpo y activa válidos`,
      'INVALID_CONTRACT_CLAUSE',
    );
  }
  if (titulo.length > 160 || cuerpo.length > 10_000) {
    throw new BadRequestError(`clauses[${index}] excede el tamaño permitido`, 'INVALID_CONTRACT_CLAUSE');
  }
  assertValidPlaceholders(cuerpo, index);
  return { id, titulo, cuerpo, activa };
};

const parseSaveInput = (input: unknown): Omit<SaveContractTemplateCommand, 'tenantId'> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestError('El cuerpo debe ser un objeto', 'INVALID_CONTRACT_TEMPLATE');
  }
  const body = input as Record<string, unknown>;
  const expectedVersion = body.expectedVersion;
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new BadRequestError('expectedVersion debe ser un entero no negativo', 'INVALID_TEMPLATE_VERSION');
  }
  if (!Array.isArray(body.clauses) || body.clauses.length === 0 || body.clauses.length > 100) {
    throw new BadRequestError('clauses debe contener entre 1 y 100 cláusulas', 'INVALID_CONTRACT_TEMPLATE');
  }
  if (typeof body.showInPortal !== 'boolean') {
    throw new BadRequestError('showInPortal debe ser booleano', 'INVALID_CONTRACT_TEMPLATE');
  }
  const clauses = body.clauses.map(parseClause);
  if (new Set(clauses.map((clause) => clause.id)).size !== clauses.length) {
    throw new BadRequestError('Los ids de cláusula deben ser únicos', 'DUPLICATE_CONTRACT_CLAUSE');
  }
  return { expectedVersion, clauses, showInPortal: body.showInPortal };
};

export class ContractTemplateService {
  constructor(private readonly repository: ContractTemplateRepository) {}

  async getTemplate(tenantId: string): Promise<ContractTemplateView> {
    const current = await this.repository.get(tenantId);
    if (!current) {
      return {
        tenantId,
        configured: false,
        version: 0,
        clauses: cloneClauses(SEED_CLAUSES),
        showInPortal: false,
        legalReviewStatus: 'not_reviewed',
        legalNotice: LEGAL_NOTICE,
        updatedAt: null,
      };
    }
    return {
      tenantId,
      configured: true,
      version: current.version,
      clauses: cloneClauses(current.clauses),
      showInPortal: current.showInPortal,
      legalReviewStatus: 'tenant_managed',
      updatedAt: current.updatedAt,
    };
  }

  async saveTemplate(tenantId: string, input: unknown): Promise<ContractTemplateView> {
    const parsed = parseSaveInput(input);
    const saved = await this.repository.save({ tenantId, ...parsed });
    return {
      tenantId: saved.tenantId,
      configured: true,
      version: saved.version,
      clauses: cloneClauses(saved.clauses),
      showInPortal: saved.showInPortal,
      legalReviewStatus: 'tenant_managed',
      updatedAt: saved.updatedAt,
    };
  }

  listVariables(): ContractVariableDefinition[] {
    return VARIABLE_CATALOG.map((variable) => ({ ...variable }));
  }
}

let singleton: ContractTemplateService | null = null;
let memoryRepository: MemoryContractTemplateRepository | null = null;

export const getContractTemplateService = (): ContractTemplateService => {
  if (!singleton) {
    if (isSupabaseAdminConfigured && supabaseAdmin) {
      singleton = new ContractTemplateService(new SupabaseContractTemplateRepository(supabaseAdmin));
    } else {
      memoryRepository = new MemoryContractTemplateRepository();
      singleton = new ContractTemplateService(memoryRepository);
    }
  }
  return singleton;
};

export const resetContractTemplateService = (): void => {
  memoryRepository?.clear();
  memoryRepository = null;
  singleton = null;
};

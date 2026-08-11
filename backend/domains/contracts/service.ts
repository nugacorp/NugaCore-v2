import { createHash, randomUUID } from 'node:crypto';
import { BadRequestError, ConflictError, NotFoundError } from '../../common/errors';
import type { AppRole } from '../../common/rbac';
import { buildDocumentPath, removeDocumentObject, uploadDocumentObject } from '../../services/supabase-storage';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { getContractTemplateService } from '../contract-templates/service';
import { getCustomersService } from '../customers/service';
import { getPlansService } from '../plans/service';
import { getTenancyService } from '../tenancy/service';
import { PdfKitContractRenderer } from './pdf';
import { SupabaseContractsRepository } from './repository';
import type { ContractTemplateView } from '../contract-templates/types';
import type { Client, Plan } from '../../../src/types';
import type { ContractRecord, ContractSignatureEvidence } from './types';

export const MAX_CONTRACT_SIGNATURE_BYTES = 48 * 1024;

export interface ContractSignApplyCommand {
  tenantId: string;
  contractId: string;
  documentId: string;
  fileName: string;
  storagePath: string;
  mimeType: 'application/pdf';
  pdfSha256: string;
  witnessUserId: string;
  witnessRole: AppRole;
  signerIp: string | null;
  userAgent: string | null;
  geo: ContractSignatureEvidence['geo'];
  signedAt: string;
}

export interface ContractSignApplyResult {
  contractId: string;
  clientId: string;
  documentId: string;
  pdfSha256: string;
  signedAt: string;
  alreadySigned: boolean;
  voidedContractIds: string[];
}

export interface ContractSignResult extends ContractSignApplyResult {
  concurrentAttemptDiscarded: boolean;
}

export interface ContractsRepository {
  createDraft(record: ContractRecord): Promise<ContractRecord>;
  get(tenantId: string, contractId: string): Promise<ContractRecord | null>;
  getEvidence(tenantId: string, contractId: string): Promise<ContractSignatureEvidence | null>;
  signApply(command: ContractSignApplyCommand): Promise<ContractSignApplyResult>;
  deleteDraft(tenantId: string, contractId: string): Promise<boolean>;
  void(tenantId: string, contractId: string, voidedAt: string): Promise<ContractRecord | null>;
  findSignedForClient(tenantId: string, clientId: string): Promise<ContractRecord | null>;
}

export interface ContractServiceDependencies {
  repository: ContractsRepository;
  templates: { getTemplate(tenantId: string): Promise<ContractTemplateView> };
  customers: { getById(clientId: string, tenantId: string): Promise<Client | null> };
  plans: { getById(planId: string, tenantId: string): Promise<Plan | null> };
  tenants: { getTenant(tenantId: string): Promise<{ id: string; name: string; rfc?: string } | null> };
  pdf: {
    renderSignedContract(input: {
      contract: ContractRecord;
      signaturePng: Buffer;
      witness: { userId: string; role: AppRole };
    }): Promise<Buffer>;
  };
  storage: {
    upload(storagePath: string, bytes: Buffer, mimeType: string): Promise<void>;
    remove(storagePath: string): Promise<boolean>;
  };
  id(): string;
  now(): Date;
}

const cloneRecord = (record: ContractRecord): ContractRecord => ({
  ...record,
  renderedClauses: record.renderedClauses.map((clause) => ({ ...clause })),
});

export class MemoryContractsRepository implements ContractsRepository {
  private readonly records = new Map<string, ContractRecord>();
  private readonly evidence = new Map<string, ContractSignatureEvidence>();

  async createDraft(record: ContractRecord): Promise<ContractRecord> {
    this.records.set(`${record.tenantId}:${record.id}`, cloneRecord(record));
    return cloneRecord(record);
  }

  async get(tenantId: string, contractId: string): Promise<ContractRecord | null> {
    const record = this.records.get(`${tenantId}:${contractId}`);
    return record ? cloneRecord(record) : null;
  }

  async getEvidence(tenantId: string, contractId: string): Promise<ContractSignatureEvidence | null> {
    const record = this.evidence.get(`${tenantId}:${contractId}`);
    return record ? structuredClone(record) : null;
  }

  async signApply(command: ContractSignApplyCommand): Promise<ContractSignApplyResult> {
    const key = `${command.tenantId}:${command.contractId}`;
    const current = this.records.get(key);
    if (!current) throw new NotFoundError('Contrato no encontrado', 'CONTRACT_NOT_FOUND');
    if (current.status === 'signed' && current.documentId && current.pdfSha256 && current.signedAt) {
      return {
        contractId: current.id,
        clientId: current.clientId,
        documentId: current.documentId,
        pdfSha256: current.pdfSha256,
        signedAt: current.signedAt,
        alreadySigned: true,
        voidedContractIds: [],
      };
    }
    if (current.status !== 'draft') {
      throw new ConflictError('El contrato no se puede firmar en su estado actual', 'CONTRACT_NOT_SIGNABLE');
    }

    const voidedContractIds: string[] = [];
    for (const [otherKey, other] of this.records) {
      if (
        otherKey !== key
        && other.tenantId === command.tenantId
        && other.clientId === current.clientId
        && other.status === 'signed'
      ) {
        other.status = 'voided';
        other.voidedAt = command.signedAt;
        other.updatedAt = command.signedAt;
        voidedContractIds.push(other.id);
      }
    }

    current.status = 'signed';
    current.documentId = command.documentId;
    current.pdfSha256 = command.pdfSha256;
    current.signedAt = command.signedAt;
    current.updatedAt = command.signedAt;
    this.evidence.set(key, {
      id: `cse-${command.contractId}`,
      tenantId: command.tenantId,
      contractId: command.contractId,
      pdfSha256: command.pdfSha256,
      signedAt: command.signedAt,
      witnessUserId: command.witnessUserId,
      witnessRole: command.witnessRole,
      signerIp: command.signerIp,
      userAgent: command.userAgent,
      geo: command.geo ? structuredClone(command.geo) : null,
      createdAt: command.signedAt,
    });
    return {
      contractId: current.id,
      clientId: current.clientId,
      documentId: command.documentId,
      pdfSha256: command.pdfSha256,
      signedAt: command.signedAt,
      alreadySigned: false,
      voidedContractIds: voidedContractIds.sort(),
    };
  }

  async deleteDraft(tenantId: string, contractId: string): Promise<boolean> {
    const key = `${tenantId}:${contractId}`;
    const current = this.records.get(key);
    if (!current || current.status !== 'draft') return false;
    return this.records.delete(key);
  }

  async void(tenantId: string, contractId: string, voidedAt: string): Promise<ContractRecord | null> {
    const current = this.records.get(`${tenantId}:${contractId}`);
    if (!current) return null;
    if (current.status !== 'voided') {
      current.status = 'voided';
      current.voidedAt = voidedAt;
      current.updatedAt = voidedAt;
    }
    return cloneRecord(current);
  }

  async findSignedForClient(tenantId: string, clientId: string): Promise<ContractRecord | null> {
    const matches = [...this.records.values()]
      .filter((record) => record.tenantId === tenantId && record.clientId === clientId && record.status === 'signed')
      .sort((a, b) => String(b.signedAt).localeCompare(String(a.signedAt)));
    return matches[0] ? cloneRecord(matches[0]) : null;
  }
}

type Geo = NonNullable<ContractSignatureEvidence['geo']>;

const parseGeo = (value: unknown): Geo | null => {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError('geo debe ser un objeto', 'INVALID_CONTRACT_GEO');
  }
  const geo = value as Record<string, unknown>;
  if (Object.keys(geo).some((key) => !['latitude', 'longitude', 'accuracy'].includes(key))) {
    throw new BadRequestError('geo contiene campos no permitidos', 'INVALID_CONTRACT_GEO');
  }
  if (
    typeof geo.latitude !== 'number'
    || !Number.isFinite(geo.latitude)
    || geo.latitude < -90
    || geo.latitude > 90
    || typeof geo.longitude !== 'number'
    || !Number.isFinite(geo.longitude)
    || geo.longitude < -180
    || geo.longitude > 180
    || (geo.accuracy !== undefined
      && (typeof geo.accuracy !== 'number' || !Number.isFinite(geo.accuracy) || geo.accuracy < 0))
  ) {
    throw new BadRequestError('geo contiene coordenadas inválidas', 'INVALID_CONTRACT_GEO');
  }
  return {
    latitude: geo.latitude,
    longitude: geo.longitude,
    ...(geo.accuracy !== undefined ? { accuracy: geo.accuracy } : {}),
  };
};

const parseSignatureInput = (input: unknown): { signaturePng: Buffer; geo: Geo | null } => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestError('El cuerpo debe ser un objeto', 'INVALID_CONTRACT_SIGNATURE');
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['signaturePng', 'geo'].includes(key))) {
    throw new BadRequestError('El cuerpo contiene campos no permitidos', 'INVALID_CONTRACT_SIGNATURE');
  }
  if (typeof body.signaturePng !== 'string') {
    throw new BadRequestError('signaturePng debe ser un PNG base64', 'INVALID_CONTRACT_SIGNATURE');
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.signaturePng);
  if (!match) {
    throw new BadRequestError('signaturePng debe ser un PNG base64', 'INVALID_CONTRACT_SIGNATURE');
  }
  const bytes = Buffer.from(match[1], 'base64');
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (canonical !== match[1].replace(/=+$/, '')) {
    throw new BadRequestError('signaturePng contiene base64 inválido', 'INVALID_CONTRACT_SIGNATURE');
  }
  if (bytes.length > MAX_CONTRACT_SIGNATURE_BYTES) {
    throw new BadRequestError(
      `La firma excede el máximo de ${MAX_CONTRACT_SIGNATURE_BYTES} bytes`,
      'CONTRACT_SIGNATURE_TOO_LARGE',
    );
  }
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < pngMagic.length || !bytes.subarray(0, pngMagic.length).equals(pngMagic)) {
    throw new BadRequestError('signaturePng no contiene un PNG válido', 'INVALID_CONTRACT_SIGNATURE');
  }
  return { signaturePng: bytes, geo: parseGeo(body.geo) };
};

export interface ContractWitnessContext {
  userId: string;
  role: AppRole;
  signerIp?: string | null;
  userAgent?: string | null;
}

const parseGenerateInput = (input: unknown): { clientId: string } => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestError('El cuerpo debe ser un objeto', 'INVALID_CONTRACT_GENERATION');
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'clientId')) {
    throw new BadRequestError('El cuerpo contiene campos no permitidos', 'INVALID_CONTRACT_GENERATION');
  }
  if (typeof body.clientId !== 'string' || !body.clientId.trim() || body.clientId.length > 128) {
    throw new BadRequestError('clientId debe ser un string válido', 'INVALID_CONTRACT_CLIENT_ID');
  }
  return { clientId: body.clientId.trim() };
};

const variableValues = (
  client: Client,
  plan: Plan,
  tenant: { name: string; rfc?: string },
  now: Date,
): Record<string, string | undefined> => ({
  '{{cliente.nombre}}': client.name?.trim() || undefined,
  '{{cliente.rfc}}': typeof (client as Client & { rfc?: unknown }).rfc === 'string'
    ? (client as Client & { rfc: string }).rfc.trim() || undefined
    : undefined,
  '{{cliente.direccion}}': client.address?.trim() || undefined,
  '{{plan.nombre}}': plan.name?.trim() || undefined,
  '{{plan.velocidad}}': Number.isFinite(plan.speedMbpsDown) && Number.isFinite(plan.speedMbpsUp)
    ? `${plan.speedMbpsDown} Mbps descarga / ${plan.speedMbpsUp} Mbps subida`
    : undefined,
  '{{precio}}': Number.isFinite(plan.price) ? `$${plan.price.toFixed(2)}` : undefined,
  '{{wisp.nombre}}': tenant.name?.trim() || undefined,
  '{{wisp.rfc}}': tenant.rfc?.trim() || undefined,
  '{{fecha.contrato}}': new Intl.DateTimeFormat('es-MX', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(now),
});

const renderTemplate = (
  template: ContractTemplateView,
  client: Client,
  plan: Plan,
  tenant: { name: string; rfc?: string },
  now: Date,
): { clauses: ContractRecord['renderedClauses']; text: string } => {
  const values = variableValues(client, plan, tenant, now);
  const clauses = template.clauses.filter((clause) => clause.activa).map((clause) => {
    let cuerpo = clause.cuerpo;
    for (const token of cuerpo.match(/{{[^{}]*}}/g) ?? []) {
      const value = values[token];
      if (!value) {
        throw new BadRequestError(
          `Falta el dato requerido para ${token}`,
          'CONTRACT_VARIABLE_DATA_MISSING',
        );
      }
      cuerpo = cuerpo.split(token).join(value);
    }
    if (/[{}]/.test(cuerpo)) {
      throw new BadRequestError(
        'La plantilla contiene variables sin sustituir',
        'CONTRACT_VARIABLE_DATA_MISSING',
      );
    }
    return { ...clause, cuerpo };
  });
  return {
    clauses,
    text: clauses.map((clause) => `${clause.titulo}\n${clause.cuerpo}`).join('\n\n'),
  };
};

export class ContractService {
  constructor(private readonly deps: ContractServiceDependencies) {}

  async generate(tenantId: string, input: unknown): Promise<ContractRecord> {
    const { clientId } = parseGenerateInput(input);
    const client = await this.deps.customers.getById(clientId, tenantId);
    if (!client) throw new NotFoundError('Cliente no encontrado', 'CONTRACT_CLIENT_NOT_FOUND');
    if (client.status === 'lead') {
      throw new ConflictError(
        'Convierte el prospecto a cliente antes de generar un contrato.',
        'CONTRACT_LEAD_NOT_ALLOWED',
      );
    }
    const [template, plan, tenant] = await Promise.all([
      this.deps.templates.getTemplate(tenantId),
      this.deps.plans.getById(client.planId, tenantId),
      this.deps.tenants.getTenant(tenantId),
    ]);
    if (!template.configured || template.version < 1) {
      throw new ConflictError(
        'Configura y revisa la plantilla antes de generar contratos.',
        'CONTRACT_TEMPLATE_NOT_CONFIGURED',
      );
    }
    if (!plan || !tenant) {
      throw new BadRequestError(
        'Faltan datos del plan o del WISP para generar el contrato.',
        'CONTRACT_VARIABLE_DATA_MISSING',
      );
    }
    const now = this.deps.now();
    const rendered = renderTemplate(template, client, plan, tenant, now);
    const timestamp = now.toISOString();
    return this.deps.repository.createDraft({
      id: this.deps.id(),
      tenantId,
      clientId,
      templateVersion: template.version,
      renderedClauses: rendered.clauses,
      renderedText: rendered.text,
      status: 'draft',
      documentId: null,
      pdfSha256: null,
      signedAt: null,
      voidedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async get(tenantId: string, contractId: string, clientId?: string): Promise<ContractRecord> {
    const record = await this.deps.repository.get(tenantId, contractId);
    if (!record || (clientId && record.clientId !== clientId)) {
      throw new NotFoundError('Contrato no encontrado', 'CONTRACT_NOT_FOUND');
    }
    return record;
  }

  async deleteDraft(tenantId: string, contractId: string, clientId: string): Promise<{ deleted: true }> {
    const record = await this.get(tenantId, contractId, clientId);
    if (record.status !== 'draft') {
      throw new ConflictError('Sólo se pueden eliminar contratos en borrador', 'CONTRACT_DELETE_NOT_ALLOWED');
    }
    if (!await this.deps.repository.deleteDraft(tenantId, contractId)) {
      throw new ConflictError('El contrato cambió antes de eliminarse', 'CONTRACT_DELETE_NOT_ALLOWED');
    }
    return { deleted: true };
  }

  async void(tenantId: string, contractId: string): Promise<ContractRecord> {
    const current = await this.get(tenantId, contractId);
    if (current.status === 'voided') return current;
    const record = await this.deps.repository.void(tenantId, contractId, this.deps.now().toISOString());
    if (!record) throw new NotFoundError('Contrato no encontrado', 'CONTRACT_NOT_FOUND');
    return record;
  }

  async getEvidence(tenantId: string, contractId: string): Promise<ContractSignatureEvidence> {
    await this.get(tenantId, contractId);
    const evidence = await this.deps.repository.getEvidence(tenantId, contractId);
    if (!evidence) throw new NotFoundError('Evidencia no encontrada', 'CONTRACT_EVIDENCE_NOT_FOUND');
    return evidence;
  }

  async getPortalStatus(
    tenantId: string,
    clientId: string,
  ): Promise<{ status: 'signed'; signedAt: string } | null> {
    const template = await this.deps.templates.getTemplate(tenantId);
    if (!template.showInPortal) return null;
    const signed = await this.deps.repository.findSignedForClient(tenantId, clientId);
    return signed?.signedAt ? { status: 'signed', signedAt: signed.signedAt } : null;
  }

  async sign(
    tenantId: string,
    contractId: string,
    input: unknown,
    witness: ContractWitnessContext,
  ): Promise<ContractSignResult> {
    const parsed = parseSignatureInput(input);
    if (!witness.userId?.trim() || !['super admin', 'administrador', 'tecnico'].includes(witness.role)) {
      throw new BadRequestError('Se requiere un testigo identificado', 'CONTRACT_WITNESS_REQUIRED');
    }
    const contract = await this.get(tenantId, contractId);
    if (contract.status === 'signed' && contract.documentId && contract.pdfSha256 && contract.signedAt) {
      return {
        contractId: contract.id,
        clientId: contract.clientId,
        documentId: contract.documentId,
        pdfSha256: contract.pdfSha256,
        signedAt: contract.signedAt,
        alreadySigned: true,
        voidedContractIds: [],
        concurrentAttemptDiscarded: false,
      };
    }
    if (contract.status !== 'draft') {
      throw new ConflictError('El contrato no se puede firmar en su estado actual', 'CONTRACT_NOT_SIGNABLE');
    }

    const documentId = this.deps.id();
    const fileName = `contrato-${contract.id}-firmado.pdf`;
    const storagePath = buildDocumentPath(tenantId, contract.clientId, documentId, fileName);
    const bytes = await this.deps.pdf.renderSignedContract({
      contract,
      signaturePng: parsed.signaturePng,
      witness: { userId: witness.userId.trim(), role: witness.role },
    });
    const pdfSha256 = createHash('sha256').update(bytes).digest('hex');

    const compensate = async (): Promise<void> => {
      try { await this.deps.storage.remove(storagePath); } catch { /* best effort */ }
    };
    const compensateAfterSignApplyFailure = async (): Promise<void> => {
      try {
        const current = await this.deps.repository.get(tenantId, contractId);
        if (current?.documentId !== documentId) await compensate();
      } catch {
        // The RPC result is uncertain and so is the confirming read. Preserve a possible signed PDF.
      }
    };
    try {
      await this.deps.storage.upload(storagePath, bytes, 'application/pdf');
    } catch (error) {
      await compensate();
      throw error;
    }

    let applied: ContractSignApplyResult;
    try {
      applied = await this.deps.repository.signApply({
        tenantId,
        contractId,
        documentId,
        fileName,
        storagePath,
        mimeType: 'application/pdf',
        pdfSha256,
        witnessUserId: witness.userId.trim(),
        witnessRole: witness.role,
        signerIp: witness.signerIp?.slice(0, 128) || null,
        userAgent: witness.userAgent?.slice(0, 512) || null,
        geo: parsed.geo,
        signedAt: this.deps.now().toISOString(),
      });
    } catch (error) {
      await compensateAfterSignApplyFailure();
      throw error;
    }

    if (applied.alreadySigned) await compensate();
    return {
      ...applied,
      concurrentAttemptDiscarded: applied.alreadySigned,
    };
  }
}

export const defaultContractRuntime = (): Pick<ContractServiceDependencies, 'id' | 'now'> => ({
  id: () => `contract-${randomUUID()}`,
  now: () => new Date(),
});

let singleton: ContractService | null = null;

export const getContractService = (): ContractService => {
  if (!singleton) {
    const repository: ContractsRepository = isSupabaseAdminConfigured && supabaseAdmin
      ? new SupabaseContractsRepository(supabaseAdmin)
      : new MemoryContractsRepository();
    singleton = new ContractService({
      repository,
      templates: getContractTemplateService(),
      customers: getCustomersService(),
      plans: getPlansService(),
      tenants: getTenancyService(),
      pdf: new PdfKitContractRenderer(),
      storage: { upload: uploadDocumentObject, remove: removeDocumentObject },
      ...defaultContractRuntime(),
    });
  }
  return singleton;
};

export const setContractServiceForTests = (service: ContractService | null): void => {
  singleton = service;
};

export const resetContractService = (): void => { singleton = null; };

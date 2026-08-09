import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContractRecord, ContractSignatureEvidence } from './types';
import type { ContractSignApplyCommand, ContractSignApplyResult, ContractsRepository } from './service';

type Row = Record<string, unknown>;
const contractFromRow = (row: Row): ContractRecord => ({
  id: String(row.id), tenantId: String(row.tenant_id), clientId: String(row.client_id),
  templateVersion: Number(row.template_version), renderedClauses: structuredClone(row.rendered_clauses ?? []) as ContractRecord['renderedClauses'],
  renderedText: String(row.rendered_text ?? ''), status: row.status as ContractRecord['status'],
  documentId: row.document_id ? String(row.document_id) : null, pdfSha256: row.pdf_sha256 ? String(row.pdf_sha256) : null,
  signedAt: row.signed_at ? String(row.signed_at) : null, voidedAt: row.voided_at ? String(row.voided_at) : null,
  createdAt: String(row.created_at), updatedAt: String(row.updated_at),
});

const evidenceFromRow = (row: Row): ContractSignatureEvidence => ({
  id: String(row.id), tenantId: String(row.tenant_id), contractId: String(row.contract_id),
  pdfSha256: String(row.pdf_sha256), signedAt: String(row.signed_at), witnessUserId: String(row.witness_user_id),
  witnessRole: row.witness_role as ContractSignatureEvidence['witnessRole'], signerIp: row.signer_ip ? String(row.signer_ip) : null,
  userAgent: row.user_agent ? String(row.user_agent) : null,
  geo: row.geo ? structuredClone(row.geo) as ContractSignatureEvidence['geo'] : null,
  createdAt: String(row.created_at),
});

export class SupabaseContractsRepository implements ContractsRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async createDraft(record: ContractRecord): Promise<ContractRecord> {
    const { data, error } = await this.admin.from('contracts').insert({
      id: record.id, tenant_id: record.tenantId, client_id: record.clientId,
      template_version: record.templateVersion, rendered_clauses: record.renderedClauses,
      rendered_text: record.renderedText, status: 'draft', created_at: record.createdAt, updated_at: record.updatedAt,
    }).select('*').single();
    if (error) throw error;
    return contractFromRow(data as Row);
  }

  async get(tenantId: string, contractId: string): Promise<ContractRecord | null> {
    const { data, error } = await this.admin.from('contracts').select('*')
      .eq('tenant_id', tenantId).eq('id', contractId).maybeSingle();
    if (error) throw error;
    return data ? contractFromRow(data as Row) : null;
  }

  async getEvidence(tenantId: string, contractId: string): Promise<ContractSignatureEvidence | null> {
    const { data, error } = await this.admin.from('contract_signature_evidence').select('*')
      .eq('tenant_id', tenantId).eq('contract_id', contractId).maybeSingle();
    if (error) throw error;
    return data ? evidenceFromRow(data as Row) : null;
  }

  async signApply(command: ContractSignApplyCommand): Promise<ContractSignApplyResult> {
    const { data, error } = await this.admin.rpc('contract_sign_apply', {
      p_tenant_id: command.tenantId, p_contract_id: command.contractId, p_document_id: command.documentId,
      p_file_name: command.fileName, p_storage_path: command.storagePath, p_mime_type: command.mimeType,
      p_pdf_sha256: command.pdfSha256, p_witness_user_id: command.witnessUserId,
      p_witness_role: command.witnessRole, p_signer_ip: command.signerIp,
      p_user_agent: command.userAgent, p_geo: command.geo,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    return {
      contractId: String(row.contract_id), clientId: String(row.client_id), documentId: String(row.document_id),
      pdfSha256: String(row.pdf_sha256), signedAt: String(row.signed_at), alreadySigned: Boolean(row.already_signed),
      voidedContractIds: Array.isArray(row.voided_contract_ids) ? row.voided_contract_ids.map(String) : [],
    };
  }

  async deleteDraft(tenantId: string, contractId: string): Promise<boolean> {
    const { data, error } = await this.admin.from('contracts').delete().eq('tenant_id', tenantId)
      .eq('id', contractId).eq('status', 'draft').select('id').maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  async void(tenantId: string, contractId: string, voidedAt: string): Promise<ContractRecord | null> {
    const { data, error } = await this.admin.from('contracts').update({ status: 'voided', voided_at: voidedAt, updated_at: voidedAt })
      .eq('tenant_id', tenantId).eq('id', contractId).select('*').maybeSingle();
    if (error) throw error;
    return data ? contractFromRow(data as Row) : null;
  }

  async findSignedForClient(tenantId: string, clientId: string): Promise<ContractRecord | null> {
    const { data, error } = await this.admin.from('contracts').select('*').eq('tenant_id', tenantId)
      .eq('client_id', clientId).eq('status', 'signed').order('signed_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data ? contractFromRow(data as Row) : null;
  }
}

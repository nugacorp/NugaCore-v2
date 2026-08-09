import type { AppRole } from '../../common/rbac';
import type { ContractClause } from '../contract-templates/types';

export type ContractStatus = 'draft' | 'signed' | 'voided';

export interface ContractRecord {
  id: string;
  tenantId: string;
  clientId: string;
  templateVersion: number;
  renderedClauses: ContractClause[];
  renderedText: string;
  status: ContractStatus;
  documentId: string | null;
  pdfSha256: string | null;
  signedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractSignatureEvidence {
  id: string;
  tenantId: string;
  contractId: string;
  pdfSha256: string;
  signedAt: string;
  witnessUserId: string;
  witnessRole: AppRole;
  signerIp: string | null;
  userAgent: string | null;
  geo: { latitude: number; longitude: number; accuracy?: number } | null;
  createdAt: string;
}


export interface ContractClause {
  id: string;
  titulo: string;
  cuerpo: string;
  activa: boolean;
}

export interface ContractTemplateRecord {
  id: string;
  tenantId: string;
  clauses: ContractClause[];
  version: number;
  showInPortal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContractTemplateView {
  tenantId: string;
  configured: boolean;
  version: number;
  clauses: ContractClause[];
  showInPortal: boolean;
  legalReviewStatus: 'not_reviewed' | 'tenant_managed';
  legalNotice?: string;
  updatedAt: string | null;
}

export interface ContractVariableDefinition {
  token: string;
  label: string;
  description: string;
  example: string;
}

export interface SaveContractTemplateCommand {
  tenantId: string;
  expectedVersion: number;
  clauses: ContractClause[];
  showInPortal: boolean;
}

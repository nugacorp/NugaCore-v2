// ====================================================================
// Automation Engine Foundation (PROD-8) — Decision Engine.
//
// El motor de automatizacion es el CEREBRO de NugaCore: recibe eventos,
// evalua reglas y devuelve UNICAMENTE decisiones descriptivas. NUNCA
// ejecuta acciones, no toca routers reales, no usa ejecucion en vivo, no
// cambia estados reales. Todo es dryRun=true.
// ====================================================================

export const AUTOMATION_EVENTS = [
  'CLIENT_CREATED',
  'CUSTOMER_UPDATED',
  'PAYMENT_REGISTERED',
  'INVOICE_OVERDUE',
  'PLAN_CHANGED',
  'SERVICE_CANCELLED',
  'INSTALLATION_COMPLETED',
  'ROUTER_REGISTERED',
  'IP_ASSIGNED',
  'NOC_ALERT',
  'TICKET_CREATED',
  'TICKET_CLOSED',
  'INVENTORY_RESERVED',
  'INVENTORY_RELEASED',
  'PROVISIONING_APPROVED',
  'PROVISIONING_REJECTED',
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export const AUTOMATION_DECISIONS = [
  'NOTHING',
  'CREATE_PROVISIONING',
  'REQUEST_SUSPENSION',
  'REQUEST_REACTIVATION',
  'REQUEST_PLAN_CHANGE',
  'REQUEST_NOTIFICATION',
  'REQUEST_IP_ASSIGNMENT',
  'REQUEST_INSTALLATION',
  'REQUEST_REVIEW',
] as const;
export type AutomationDecision = (typeof AUTOMATION_DECISIONS)[number];

// Origen de una decision. Permite trazar quien la propuso sin ejecutarla.
export const DECISION_SOURCES = [
  'Automation',
  'Manual',
  'Billing',
  'CRM',
  'NOC',
  'Inventory',
] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];

// Contexto de evaluacion: datos descriptivos de SOLO LECTURA derivados de
// otros dominios (Billing, CRM, IPAM, etc.). El motor nunca los modifica.
export interface AutomationContext {
  event: AutomationEvent;
  customerId?: string;
  payload: Record<string, unknown>;
}

// Condicion de una regla: funcion pura sobre el contexto. Devuelve boolean.
export type AutomationCondition = (context: AutomationContext) => boolean;

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  event: AutomationEvent;
  condition: AutomationCondition;
  decision: AutomationDecision;
  description: string;
  createdAt: string;
  updatedAt: string;
}

// Vista serializable de una regla (sin la funcion condition) para la API.
export interface AutomationRuleView {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  event: AutomationEvent;
  decision: AutomationDecision;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionPreviewStep {
  id: string;
  description: string;
}

// Una decision producida por el motor. SIEMPRE descriptiva, nunca ejecutable.
export interface DecisionRecord {
  id: string;
  event: AutomationEvent;
  customerId?: string;
  decision: AutomationDecision;
  ruleId: string;
  ruleName: string;
  source: DecisionSource;
  priority: number;
  executionPreview: ExecutionPreviewStep[];
  status: 'PENDING';
  createdAt: string;
  dryRun: true;
}

export interface SimulationInput {
  event?: unknown;
  customerId?: unknown;
  payload?: unknown;
}

export interface SimulationResult {
  event: AutomationEvent;
  customerId?: string;
  rulesEvaluated: number;
  rulesMatched: AutomationRuleView[];
  decisions: DecisionRecord[];
  executionPreview: ExecutionPreviewStep[];
  dryRun: true;
}

export interface AutomationAuditEntry {
  id: string;
  event: AutomationEvent;
  customerId?: string;
  rulesEvaluated: number;
  rulesMatched: string[];
  decisions: AutomationDecision[];
  executionPreview: ExecutionPreviewStep[];
  actor: string;
  dryRun: true;
  createdAt: string;
}

export interface AutomationSummary {
  totalRules: number;
  enabledRules: number;
  supportedEvents: number;
  supportedDecisions: number;
  pendingDecisions: number;
  simulationsRun: number;
  dryRun: true;
}

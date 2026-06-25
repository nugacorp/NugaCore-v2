// ====================================================================
// Automation audit (PROD-8 / FASE M).
//
// Registra cada evaluacion del motor: evento, reglas evaluadas, reglas
// coincidentes, decisiones, executionPreview, actor, dryRun=true y
// timestamp. Nunca registra secretos: solo metadatos descriptivos.
// ====================================================================

import { automationStore } from './store';
import {
  AutomationAuditEntry,
  AutomationContext,
  AutomationRule,
  DecisionRecord,
  ExecutionPreviewStep,
} from './types';

export const recordEvaluationAudit = (params: {
  context: AutomationContext;
  rulesEvaluated: number;
  rulesMatched: AutomationRule[];
  decisions: DecisionRecord[];
  executionPreview: ExecutionPreviewStep[];
  actor: string;
}): AutomationAuditEntry => {
  const entry: AutomationAuditEntry = {
    id: automationStore.nextAuditId(),
    event: params.context.event,
    customerId: params.context.customerId,
    rulesEvaluated: params.rulesEvaluated,
    rulesMatched: params.rulesMatched.map((rule) => rule.id),
    decisions: params.decisions.map((decision) => decision.decision),
    executionPreview: params.executionPreview,
    actor: params.actor,
    dryRun: true,
    createdAt: new Date().toISOString(),
  };
  return automationStore.appendAudit(entry);
};

export const listAudit = (): AutomationAuditEntry[] => automationStore.listAudit();

export const auditForCustomer = (customerId: string): AutomationAuditEntry[] =>
  automationStore.auditForCustomer(customerId);

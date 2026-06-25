// ====================================================================
// Automation in-memory store (PROD-8).
//
// Mantiene las reglas semilla, las decisiones simuladas y la bitacora de
// auditoria. Es SOLO almacenamiento descriptivo: ninguna entrada aqui
// dispara efectos reales. Las reglas son de lectura (FASE N: nadie las
// modifica todavia).
// ====================================================================

import { buildDefaultRules } from './rules';
import {
  AutomationAuditEntry,
  AutomationRule,
  DecisionRecord,
} from './types';

let RULES: AutomationRule[] = buildDefaultRules();
const DECISIONS: DecisionRecord[] = [];
const AUDIT: AutomationAuditEntry[] = [];
let decisionCounter = 0;
let auditCounter = 0;
let simulationsRun = 0;

const nextDecisionId = (): string => {
  decisionCounter += 1;
  return `dec-${decisionCounter}`;
};

const nextAuditId = (): string => {
  auditCounter += 1;
  return `auto-audit-${auditCounter}`;
};

export const automationStore = {
  listRules(): AutomationRule[] {
    return [...RULES];
  },

  getRule(id: string): AutomationRule | undefined {
    return RULES.find((rule) => rule.id === id);
  },

  recordDecision(decision: DecisionRecord): DecisionRecord {
    DECISIONS.unshift(decision);
    return decision;
  },

  listDecisions(): DecisionRecord[] {
    return [...DECISIONS];
  },

  decisionsForCustomer(customerId: string): DecisionRecord[] {
    return DECISIONS.filter((item) => item.customerId === customerId);
  },

  appendAudit(entry: AutomationAuditEntry): AutomationAuditEntry {
    AUDIT.unshift(entry);
    return entry;
  },

  listAudit(): AutomationAuditEntry[] {
    return [...AUDIT];
  },

  auditForCustomer(customerId: string): AutomationAuditEntry[] {
    return AUDIT.filter((item) => item.customerId === customerId);
  },

  markSimulationRun(): void {
    simulationsRun += 1;
  },

  stats(): { pendingDecisions: number; simulationsRun: number } {
    return { pendingDecisions: DECISIONS.length, simulationsRun };
  },

  nextDecisionId,
  nextAuditId,

  clearForTests(): void {
    RULES = buildDefaultRules();
    DECISIONS.length = 0;
    AUDIT.length = 0;
    decisionCounter = 0;
    auditCounter = 0;
    simulationsRun = 0;
  },
};

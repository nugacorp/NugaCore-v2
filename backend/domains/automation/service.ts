// ====================================================================
// Automation service (PROD-8) — orquestacion del Decision Engine.
//
// Recibe un evento, evalua reglas y devuelve UNICAMENTE decisiones con su
// executionPreview descriptivo. NO ejecuta acciones, no toca routers reales,
// no usa ejecucion en vivo, no cambia estados reales de ningun dominio.
//
// "Sin guardar cambios" (FASE G) = no se muta NINGUN sistema real (Billing,
// CRM, IPAM, Service Status, etc.). Las decisiones y la auditoria SI quedan
// como artefactos descriptivos dry-run para alimentar Dashboard, Client 360
// y la bitacora (FASE J/K/M). Ninguno de esos artefactos dispara efectos.
// ====================================================================

import { BadRequestError } from '../../common/errors';
import { sanitizeText } from '../../common/security/sanitize-sensitive-data';
import { recordEvaluationAudit } from './audit';
import { automationStore } from './store';
import {
  buildExecutionPreview,
  evaluateRules,
  toRuleView,
} from './rules';
import {
  AUTOMATION_DECISIONS,
  AUTOMATION_EVENTS,
  AutomationContext,
  AutomationEvent,
  AutomationRuleView,
  AutomationSummary,
  DecisionRecord,
  ExecutionPreviewStep,
  SimulationInput,
  SimulationResult,
} from './types';

const nowIso = (): string => new Date().toISOString();

const normalizeEvent = (value: unknown): AutomationEvent => {
  if (typeof value === 'string' && (AUTOMATION_EVENTS as readonly string[]).includes(value)) {
    return value as AutomationEvent;
  }
  throw new BadRequestError(
    `event invalido. Permitidos: ${AUTOMATION_EVENTS.join(', ')}`,
    'INVALID_EVENT',
  );
};

const optionalCustomerId = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? sanitizeText(value.trim()) : undefined;

const normalizePayload = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Agrega los pasos de preview de todas las decisiones, evitando duplicados
// por descripcion para no repetir narrativa.
const mergePreview = (decisions: DecisionRecord[]): ExecutionPreviewStep[] => {
  const merged: ExecutionPreviewStep[] = [];
  const seen: string[] = [];
  for (const decision of decisions) {
    for (const step of decision.executionPreview) {
      if (seen.includes(step.description)) continue;
      seen.push(step.description);
      merged.push({ id: `preview-${merged.length + 1}`, description: step.description });
    }
  }
  return merged;
};

export const automationService = {
  listRules(): AutomationRuleView[] {
    return automationStore.listRules().map(toRuleView);
  },

  getRule(id: string): AutomationRuleView {
    const rule = automationStore.getRule(id);
    if (!rule) throw new BadRequestError('Regla no encontrada.', 'RULE_NOT_FOUND');
    return toRuleView(rule);
  },

  listEvents(): readonly AutomationEvent[] {
    return AUTOMATION_EVENTS;
  },

  listDecisions(): DecisionRecord[] {
    return automationStore.listDecisions();
  },

  decisionsForCustomer(customerId: string): DecisionRecord[] {
    return automationStore.decisionsForCustomer(customerId);
  },

  summary(): AutomationSummary {
    const rules = automationStore.listRules();
    const stats = automationStore.stats();
    return {
      totalRules: rules.length,
      enabledRules: rules.filter((rule) => rule.enabled).length,
      supportedEvents: AUTOMATION_EVENTS.length,
      supportedDecisions: AUTOMATION_DECISIONS.length,
      pendingDecisions: stats.pendingDecisions,
      simulationsRun: stats.simulationsRun,
      dryRun: true,
    };
  },

  // Numero de decisiones pendientes — alimenta el KPI Automation Queue.
  pendingDecisionsCount(): number {
    return automationStore.stats().pendingDecisions;
  },

  // Corazon del motor: evalua un evento y devuelve decisiones descriptivas.
  // dryRun siempre. No muta ningun sistema real.
  simulate(input: SimulationInput, actor: string): SimulationResult {
    const event = normalizeEvent(input.event);
    const customerId = optionalCustomerId(input.customerId);
    const payload = normalizePayload(input.payload);

    const context: AutomationContext = { event, customerId, payload };
    const allRules = automationStore.listRules();
    const matched = evaluateRules(allRules, context);

    const decisions: DecisionRecord[] = matched.map((rule) => ({
      id: automationStore.nextDecisionId(),
      event,
      customerId,
      decision: rule.decision,
      ruleId: rule.id,
      ruleName: rule.name,
      source: 'Automation',
      priority: rule.priority,
      executionPreview: buildExecutionPreview(rule.decision, customerId),
      status: 'PENDING',
      createdAt: nowIso(),
      dryRun: true,
    }));

    const executionPreview = mergePreview(decisions);

    // Persistimos los artefactos descriptivos dry-run (decisiones + audit).
    // Esto NO cambia nada real; alimenta Dashboard / Client 360 / bitacora.
    decisions.forEach((decision) => automationStore.recordDecision(decision));
    automationStore.markSimulationRun();
    recordEvaluationAudit({
      context,
      rulesEvaluated: allRules.filter((rule) => rule.event === event).length,
      rulesMatched: matched,
      decisions,
      executionPreview,
      actor,
    });

    return {
      event,
      customerId,
      rulesEvaluated: allRules.filter((rule) => rule.event === event).length,
      rulesMatched: matched.map(toRuleView),
      decisions,
      executionPreview,
      dryRun: true,
    };
  },
};

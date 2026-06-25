import { describe, expect, it } from 'vitest';
import { buildDefaultRules, evaluateRules, toRuleView } from '../../backend/domains/automation/rules';
import type { AutomationContext } from '../../backend/domains/automation/types';
import { AUTOMATION_EVENTS } from '../../backend/domains/automation/types';

describe('automation rules engine', () => {
  it('cada evento soportado tiene al menos una regla', () => {
    const rules = buildDefaultRules();
    for (const event of AUTOMATION_EVENTS) {
      expect(rules.some((rule) => rule.event === event), `falta regla para ${event}`).toBe(true);
    }
  });

  it('evaluateRules solo devuelve reglas del evento y habilitadas, ordenadas por prioridad', () => {
    const rules = buildDefaultRules();
    const context: AutomationContext = { event: 'PAYMENT_REGISTERED', customerId: 'c1', payload: { wasSuspended: true } };
    const matched = evaluateRules(rules, context);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((rule) => rule.event === 'PAYMENT_REGISTERED')).toBe(true);
    for (let i = 1; i < matched.length; i += 1) {
      expect(matched[i - 1].priority).toBeGreaterThanOrEqual(matched[i].priority);
    }
  });

  it('condicion falsa excluye la regla', () => {
    const rules = buildDefaultRules();
    const matched = evaluateRules(rules, { event: 'PAYMENT_REGISTERED', payload: { wasSuspended: false } });
    expect(matched.map((r) => r.decision)).not.toContain('REQUEST_REACTIVATION');
  });

  it('reglas deshabilitadas no coinciden', () => {
    const rules = buildDefaultRules().map((rule) => ({ ...rule, enabled: false }));
    const matched = evaluateRules(rules, { event: 'INVOICE_OVERDUE', payload: {} });
    expect(matched).toHaveLength(0);
  });

  it('toRuleView no expone la funcion condition', () => {
    const view = toRuleView(buildDefaultRules()[0]);
    expect(view).not.toHaveProperty('condition');
    expect(view).toHaveProperty('decision');
    expect(view).toHaveProperty('event');
  });

  it('una condicion que lanza no rompe la evaluacion', () => {
    const rules = buildDefaultRules();
    rules[0] = { ...rules[0], event: 'NOC_ALERT', condition: () => { throw new Error('boom'); } };
    const matched = evaluateRules(rules, { event: 'NOC_ALERT', payload: { severity: 'critical' } });
    expect(matched.every((rule) => rule.id !== rules[0].id)).toBe(true);
  });
});

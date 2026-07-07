import { Ticket } from '../../../src/types';
import { store } from '../../state/store';

export interface SlaRule {
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  maxHours: number;
}

const DEFAULT_RULES: SlaRule[] = [
  { priority: 'P1', maxHours: 4 },
  { priority: 'P2', maxHours: 8 },
  { priority: 'P3', maxHours: 24 },
  { priority: 'P4', maxHours: 72 },
];

export function getSlaRules(): SlaRule[] {
  return DEFAULT_RULES;
}

export function getSlaDeadlineHours(priority?: string | null): number {
  const rule = DEFAULT_RULES.find((r) => r.priority === priority);
  return rule?.maxHours ?? 72;
}

export function isTicketSlaBreached(ticket: Ticket, now = Date.now()): boolean {
  if (ticket.status === 'resolved' || ticket.status === 'closed') return false;
  const created = new Date(ticket.created || '').getTime();
  if (!Number.isFinite(created)) return false;
  const maxMs = getSlaDeadlineHours(ticket.priority) * 60 * 60 * 1000;
  return now - created > maxMs;
}

export function listSlaBreaches(tickets: Ticket[] = store.TICKETS): Ticket[] {
  return tickets.filter((t) => isTicketSlaBreached(t));
}

export function ticketSlaStatus(ticket: Ticket, now = Date.now()) {
  const created = new Date(ticket.created || '').getTime();
  const maxHours = getSlaDeadlineHours(ticket.priority);
  const elapsedHours = Number.isFinite(created) ? (now - created) / (60 * 60 * 1000) : 0;
  const breached = isTicketSlaBreached(ticket, now);
  return {
    priority: ticket.priority ?? 'P4',
    maxHours,
    elapsedHours: Math.round(elapsedHours * 10) / 10,
    breached,
    remainingHours: Math.max(0, Math.round((maxHours - elapsedHours) * 10) / 10),
  };
}

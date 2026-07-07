import type { CommercialAppointment, CommercialProspect, CommercialQuote } from './types';

const uid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
const now = () => new Date().toISOString();

export const commercialMemory = {
  prospects: [] as CommercialProspect[],
  quotes: [] as CommercialQuote[],
  appointments: [] as CommercialAppointment[],
};

export function newProspectId() {
  return uid('prospect');
}
export function newQuoteId() {
  return uid('quote');
}
export function newAppointmentId() {
  return uid('appt');
}
export function stamp() {
  return now();
}

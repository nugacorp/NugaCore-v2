export type CommercialStage = 'lead' | 'visit' | 'quote' | 'contract' | 'installation' | 'won' | 'lost';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
export type AppointmentType = 'visit' | 'installation' | 'survey' | 'followup';
export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled' | 'no_show';

export interface CommercialProspect {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  source?: string;
  stage: CommercialStage;
  planId?: string;
  assignedTo?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  expectedCloseDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommercialQuote {
  id: string;
  prospectId?: string;
  clientId?: string;
  planId?: string;
  title: string;
  amountCents: number;
  currency: string;
  status: QuoteStatus;
  validUntil?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommercialAppointment {
  id: string;
  prospectId?: string;
  clientId?: string;
  workOrderId?: string;
  title: string;
  appointmentType: AppointmentType;
  scheduledAt: string;
  durationMinutes: number;
  technicianId?: string;
  technicianName?: string;
  status: AppointmentStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

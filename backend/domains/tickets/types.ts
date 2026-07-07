import { TaskOrder, Ticket } from '../../../src/types';

export interface SupportFilters {
  status?: Ticket['status'] | TaskOrder['status'];
  severity?: Ticket['severity'];
  priority?: Ticket['priority'];
  type?: TaskOrder['type'];
  technicianId?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

export interface TicketCreateInput {
  clientId?: string;
  clientName: string;
  title: string;
  description?: string;
  category: Ticket['category'];
  severity: Ticket['severity'];
  priority: Ticket['priority'];
}

export interface TicketUpdateInput {
  title?: string;
  description?: string;
  category?: Ticket['category'];
  severity?: Ticket['severity'];
  priority?: Ticket['priority'];
  status?: Ticket['status'];
  technicianId?: string;
  technicianName?: string;
}

export interface WorkOrderCreateInput {
  title: string;
  type: TaskOrder['type'];
  clientId: string;
  clientName: string;
  address?: string;
  phone?: string;
  notes?: string;
  date: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  assignedTechnicianId?: string;
  technicianName?: string;
  status: TaskOrder['status'];
  checklist?: { item: string; done: boolean }[];
}

export interface WorkOrderUpdateInput {
  title?: string;
  type?: TaskOrder['type'];
  address?: string;
  phone?: string;
  notes?: string;
  date?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  assignedTechnicianId?: string;
  technicianName?: string;
  status?: TaskOrder['status'];
  checklist?: { item: string; done: boolean }[];
}

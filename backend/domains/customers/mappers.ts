// ====================================================================
// Mappers del dominio Customers — traducen entre la fila de Postgres
// (snake_case, tabla public.clients / public.client_timeline) y los tipos
// del frontend (camelCase, src/types.ts).
//
// Regla del DATA_CONTRACT: aquí ocurre la ÚNICA traducción de nombres.
// Los VALORES de enum NO se traducen (la DB ya guarda inglés: 'active', ...).
// ====================================================================

import { Client } from '../../../src/types';
import { ClientTimelineEvent } from '../../state/store';

// --- Filas de DB (forma laxa: lo que devuelve supabase-js sin tipos generados) ---
export interface ClientRow {
  id: string;
  full_name: string;
  type: Client['type'];
  status: Client['status'];
  email: string | null;
  phone: string | null;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
  connection_type: Client['connectionType'] | null;
  plan_id: string | null;
  ip_assigned: string | null;
  mac_address: string | null;
  ppp_user: string | null;
  ppp_password: string | null;
  contract_id: string | null;
  installation_photos: string[] | null;
  installation_date: string | null;
  notes: string | null;
}

export interface TimelineRow {
  id: string;
  client_id: string;
  event_type: ClientTimelineEvent['eventType'];
  summary: string;
  details: string | null;
  created_by: string | null;
  created_at: string;
}

// --- DB -> App ---------------------------------------------------------
export const rowToClient = (row: ClientRow): Client => ({
  id: row.id,
  name: row.full_name,
  type: row.type,
  status: row.status,
  email: row.email ?? '',
  phone: row.phone ?? '',
  address: row.address,
  city: row.city,
  lat: row.lat ?? 0,
  lng: row.lng ?? 0,
  planId: row.plan_id ?? '',
  ip: row.ip_assigned ?? '',
  assignedIp: row.ip_assigned ?? '',
  ...(row.connection_type ? { connectionType: row.connection_type } : {}),
  ...(row.mac_address ? { mac: row.mac_address } : {}),
  ...(row.ppp_user ? { pppoeUser: row.ppp_user } : {}),
  ...(row.ppp_password ? { pppoePassword: row.ppp_password } : {}),
  ...(row.contract_id ? { contractId: row.contract_id } : {}),
  ...(row.installation_date ? { installationDate: row.installation_date } : {}),
  ...(row.notes ? { notes: row.notes } : {}),
  installationPhotos: Array.isArray(row.installation_photos) ? row.installation_photos : [],
});

// --- App -> DB (alta: objeto Client completo) -------------------------
export const clientToRow = (client: Client): ClientRow => ({
  id: client.id,
  full_name: client.name,
  type: client.type,
  status: client.status,
  email: client.email || null,
  phone: client.phone || null,
  address: client.address,
  city: client.city,
  lat: typeof client.lat === 'number' ? client.lat : null,
  lng: typeof client.lng === 'number' ? client.lng : null,
  connection_type: client.connectionType ?? null,
  plan_id: client.planId || null,
  ip_assigned: client.assignedIp || client.ip || null,
  mac_address: client.mac ?? null,
  ppp_user: client.pppoeUser ?? null,
  ppp_password: client.pppoePassword ?? null,
  contract_id: client.contractId ?? null,
  installation_photos: client.installationPhotos ?? [],
  installation_date: client.installationDate ?? null,
  notes: client.notes ?? null,
});

// --- App -> DB (edición: solo las claves presentes en el patch) -------
const CAMEL_TO_SNAKE: Partial<Record<keyof Client, keyof ClientRow>> = {
  name: 'full_name',
  type: 'type',
  status: 'status',
  email: 'email',
  phone: 'phone',
  address: 'address',
  city: 'city',
  lat: 'lat',
  lng: 'lng',
  connectionType: 'connection_type',
  planId: 'plan_id',
  ip: 'ip_assigned',
  assignedIp: 'ip_assigned',
  mac: 'mac_address',
  pppoeUser: 'ppp_user',
  pppoePassword: 'ppp_password',
  contractId: 'contract_id',
  installationPhotos: 'installation_photos',
  installationDate: 'installation_date',
  notes: 'notes',
};

export const clientPatchToRow = (patch: Partial<Client>): Partial<ClientRow> => {
  const row: Partial<ClientRow> = {};
  for (const key of Object.keys(patch) as (keyof Client)[]) {
    const column = CAMEL_TO_SNAKE[key];
    if (!column) continue; // ignora claves desconocidas (p.ej. 'id', 'documents')
    (row as Record<string, unknown>)[column] = (patch as Record<string, unknown>)[key];
  }
  return row;
};

// --- Timeline ----------------------------------------------------------
export const rowToTimeline = (row: TimelineRow): ClientTimelineEvent => ({
  id: row.id,
  clientId: row.client_id,
  eventType: row.event_type,
  summary: row.summary,
  ...(row.details ? { details: row.details } : {}),
  createdAt: row.created_at,
  ...(row.created_by ? { createdBy: row.created_by } : {}),
});

export const timelineToRow = (
  event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>,
  id: string,
  createdAt: string,
): TimelineRow => ({
  id,
  client_id: event.clientId,
  event_type: event.eventType,
  summary: event.summary,
  details: event.details ?? null,
  created_by: event.createdBy ?? null,
  created_at: createdAt,
});

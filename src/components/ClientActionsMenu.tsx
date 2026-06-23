import React, { useEffect, useRef } from 'react';
import { Client } from '../types';
import { ClientActionCaps } from '../lib/rbac';

// ====================================================================
// Client 360 — Menú de acciones rápidas por cliente (⋮).
//
// Menú compacto agrupado que se abre desde la columna "Acciones" de la lista
// de clientes. Cada acción se muestra solo si el rol tiene la capacidad
// (ClientActionCaps). Reutiliza el tema slate/indigo actual; no introduce
// librerías nuevas. Todas las acciones son navegación / modal / simulación
// local segura (la lógica vive en CrmModule).
// ====================================================================

export type ClientQuickAction =
  | 'view-profile'
  | 'edit'
  | 'suspend'
  | 'reactivate'
  | 'change-plan'
  | 'change-ip'
  | 'register-payment'
  | 'generate-invoice'
  | 'view-invoices'
  | 'account-statement'
  | 'create-ticket'
  | 'view-tickets'
  | 'view-router'
  | 'view-location'
  | 'copy-ip'
  | 'view-history';

interface MenuItem {
  key: ClientQuickAction;
  label: string;
  cap: keyof ClientActionCaps;
  show?: (client: Client) => boolean;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const GROUPS: MenuGroup[] = [
  {
    title: 'Cliente',
    items: [
      { key: 'view-profile', label: 'Ver perfil', cap: 'viewProfile' },
      { key: 'edit', label: 'Editar cliente', cap: 'editClient' },
    ],
  },
  {
    title: 'Servicio',
    items: [
      { key: 'suspend', label: 'Suspender servicio', cap: 'suspend', show: (c) => c.status === 'active' },
      { key: 'reactivate', label: 'Reactivar servicio', cap: 'reactivate', show: (c) => c.status === 'suspended' },
      { key: 'change-plan', label: 'Cambiar plan', cap: 'changePlan' },
      { key: 'change-ip', label: 'Cambiar IP', cap: 'changeIp' },
    ],
  },
  {
    title: 'Cobranza',
    items: [
      { key: 'register-payment', label: 'Registrar pago', cap: 'registerPayment' },
      { key: 'generate-invoice', label: 'Generar factura', cap: 'generateInvoice' },
      { key: 'account-statement', label: 'Estado de cuenta', cap: 'accountStatement' },
    ],
  },
  {
    title: 'Soporte',
    items: [
      { key: 'create-ticket', label: 'Crear ticket', cap: 'createTicket' },
      { key: 'view-tickets', label: 'Ver tickets', cap: 'viewTickets' },
    ],
  },
  {
    title: 'Red',
    items: [
      { key: 'view-router', label: 'Ver router', cap: 'viewRouter' },
      { key: 'view-location', label: 'Ver ubicación', cap: 'viewLocation' },
      { key: 'copy-ip', label: 'Copiar IP', cap: 'copyIp' },
    ],
  },
  {
    title: 'Historial',
    items: [
      { key: 'view-history', label: 'Ver eventos', cap: 'viewHistory' },
    ],
  },
];

interface Props {
  client: Client;
  caps: ClientActionCaps;
  onAction: (action: ClientQuickAction, client: Client) => void;
  onClose: () => void;
}

export default function ClientActionsMenu({ client, caps, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const visibleGroups = GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => caps[item.cap] && (!item.show || item.show(client))),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div
      ref={ref}
      id={`crm-actions-menu-${client.id}`}
      role="menu"
      className="absolute right-0 z-40 mt-1 w-52 rounded-xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/40 py-1.5 text-left"
      onClick={(e) => e.stopPropagation()}
    >
      {visibleGroups.length === 0 && (
        <div className="px-3 py-2 text-[10px] font-mono text-slate-500">Sin acciones disponibles.</div>
      )}
      {visibleGroups.map((group) => (
        <div key={group.title} className="px-1.5 py-1">
          <div className="px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-slate-500">{group.title}</div>
          {group.items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              id={`crm-action-${item.key}-${client.id}`}
              onClick={() => onAction(item.key, client)}
              className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-slate-900 hover:text-white"
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

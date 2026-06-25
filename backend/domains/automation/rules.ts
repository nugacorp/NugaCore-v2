// ====================================================================
// Automation Rules Engine (PROD-8).
//
// El motor recibe un evento, evalua las reglas habilitadas cuyo `event`
// coincide y devuelve UNICAMENTE las reglas que cumplen su `condition`.
// Las reglas NO ejecutan nada: solo proponen una `decision` descriptiva.
//
// Todas las `condition` son funciones PURAS sobre el contexto. No leen ni
// modifican estado real: el payload trae datos descriptivos de SOLO lectura
// derivados de otros dominios (Billing, CRM, IPAM, Inventory, NOC...).
// ====================================================================

import {
  AutomationContext,
  AutomationDecision,
  AutomationEvent,
  AutomationRule,
  AutomationRuleView,
  ExecutionPreviewStep,
} from './types';

const nowIso = (): string => new Date().toISOString();

// Helpers de lectura segura del payload (nunca lanzan).
const flag = (context: AutomationContext, key: string): boolean =>
  context.payload[key] === true || context.payload[key] === 'true';

const num = (context: AutomationContext, key: string): number => {
  const value = context.payload[key];
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
};

const always = (): boolean => true;

// Definicion declarativa de las reglas semilla. Una regla por intencion.
// `priority` mas alto = se evalua/ordena primero.
interface RuleSeed {
  name: string;
  event: AutomationEvent;
  priority: number;
  decision: AutomationDecision;
  description: string;
  condition: (context: AutomationContext) => boolean;
}

const SEED: RuleSeed[] = [
  {
    name: 'Factura vencida -> proponer suspension',
    event: 'INVOICE_OVERDUE',
    priority: 100,
    decision: 'REQUEST_SUSPENSION',
    description: 'Cuando una factura supera el vencimiento, propone revisar la suspension del servicio.',
    condition: (context) => num(context, 'daysOverdue') >= 1 || always(),
  },
  {
    name: 'Pago registrado -> proponer reactivacion',
    event: 'PAYMENT_REGISTERED',
    priority: 95,
    decision: 'REQUEST_REACTIVATION',
    description: 'Cuando un cliente suspendido regulariza su pago, propone reactivar el servicio.',
    condition: (context) => flag(context, 'wasSuspended'),
  },
  {
    name: 'Pago registrado -> notificar comprobante',
    event: 'PAYMENT_REGISTERED',
    priority: 40,
    decision: 'REQUEST_NOTIFICATION',
    description: 'Cuando se registra un pago, propone notificar el comprobante al cliente.',
    condition: () => true,
  },
  {
    name: 'Alta de cliente -> proponer instalacion',
    event: 'CLIENT_CREATED',
    priority: 80,
    decision: 'REQUEST_INSTALLATION',
    description: 'Cuando se crea un cliente nuevo, propone agendar la instalacion.',
    condition: () => true,
  },
  {
    name: 'Cliente actualizado -> revisar consistencia',
    event: 'CUSTOMER_UPDATED',
    priority: 20,
    decision: 'REQUEST_REVIEW',
    description: 'Cuando cambian datos sensibles del cliente, propone una revision manual.',
    condition: (context) => flag(context, 'sensitiveFields'),
  },
  {
    name: 'Cambio de plan -> proponer ajuste de plan',
    event: 'PLAN_CHANGED',
    priority: 70,
    decision: 'REQUEST_PLAN_CHANGE',
    description: 'Cuando se cambia el plan comercial, propone preparar el cambio operativo.',
    condition: () => true,
  },
  {
    name: 'Servicio cancelado -> revisar baja',
    event: 'SERVICE_CANCELLED',
    priority: 75,
    decision: 'REQUEST_REVIEW',
    description: 'Cuando se cancela un servicio, propone revisar la baja y liberar recursos.',
    condition: () => true,
  },
  {
    name: 'Instalacion completada -> crear provisioning',
    event: 'INSTALLATION_COMPLETED',
    priority: 85,
    decision: 'CREATE_PROVISIONING',
    description: 'Cuando se completa la instalacion, propone crear la accion de provisioning.',
    condition: () => true,
  },
  {
    name: 'Router registrado -> proponer asignacion de IP',
    event: 'ROUTER_REGISTERED',
    priority: 60,
    decision: 'REQUEST_IP_ASSIGNMENT',
    description: 'Cuando se registra un equipo, propone asignar una IP disponible.',
    condition: (context) => !flag(context, 'hasIp'),
  },
  {
    name: 'IP asignada -> notificar configuracion',
    event: 'IP_ASSIGNED',
    priority: 35,
    decision: 'REQUEST_NOTIFICATION',
    description: 'Cuando se asigna una IP, propone notificar la configuracion lista.',
    condition: () => true,
  },
  {
    name: 'Alerta NOC -> revisar incidente',
    event: 'NOC_ALERT',
    priority: 90,
    decision: 'REQUEST_REVIEW',
    description: 'Cuando hay una alerta de red, propone una revision operativa del incidente.',
    condition: (context) => (context.payload.severity ?? '') !== 'info',
  },
  {
    name: 'Ticket creado -> notificar seguimiento',
    event: 'TICKET_CREATED',
    priority: 30,
    decision: 'REQUEST_NOTIFICATION',
    description: 'Cuando se crea un ticket, propone notificar el seguimiento al cliente.',
    condition: () => true,
  },
  {
    name: 'Ticket cerrado -> notificar resolucion',
    event: 'TICKET_CLOSED',
    priority: 25,
    decision: 'REQUEST_NOTIFICATION',
    description: 'Cuando se cierra un ticket, propone notificar la resolucion al cliente.',
    condition: () => true,
  },
  {
    name: 'Inventario reservado -> proponer instalacion',
    event: 'INVENTORY_RESERVED',
    priority: 50,
    decision: 'REQUEST_INSTALLATION',
    description: 'Cuando se reserva equipo, propone agendar la instalacion correspondiente.',
    condition: () => true,
  },
  {
    name: 'Inventario liberado -> revisar disponibilidad',
    event: 'INVENTORY_RELEASED',
    priority: 15,
    decision: 'REQUEST_REVIEW',
    description: 'Cuando se libera equipo, propone revisar la disponibilidad del almacen.',
    condition: () => true,
  },
  {
    name: 'Provisioning aprobado -> notificar cliente',
    event: 'PROVISIONING_APPROVED',
    priority: 65,
    decision: 'REQUEST_NOTIFICATION',
    description: 'Cuando se aprueba un provisioning, propone notificar al cliente.',
    condition: () => true,
  },
  {
    name: 'Provisioning rechazado -> revisar rechazo',
    event: 'PROVISIONING_REJECTED',
    priority: 55,
    decision: 'REQUEST_REVIEW',
    description: 'Cuando se rechaza un provisioning, propone revisar el motivo del rechazo.',
    condition: () => true,
  },
];

// Construye el set inmutable de reglas semilla con timestamps e ids estables.
export const buildDefaultRules = (): AutomationRule[] => {
  const createdAt = nowIso();
  return SEED.map((seed, index) => ({
    id: `rule-${index + 1}`,
    name: seed.name,
    enabled: true,
    priority: seed.priority,
    event: seed.event,
    condition: seed.condition,
    decision: seed.decision,
    description: seed.description,
    createdAt,
    updatedAt: createdAt,
  }));
};

// Proyeccion serializable (sin la funcion condition) para exponer por API.
export const toRuleView = (rule: AutomationRule): AutomationRuleView => ({
  id: rule.id,
  name: rule.name,
  enabled: rule.enabled,
  priority: rule.priority,
  event: rule.event,
  decision: rule.decision,
  description: rule.description,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

// Evalua reglas para un contexto. Devuelve UNICAMENTE las coincidentes,
// ordenadas por prioridad descendente. Nunca produce efectos.
export const evaluateRules = (
  rules: AutomationRule[],
  context: AutomationContext,
): AutomationRule[] =>
  rules
    .filter((rule) => rule.enabled && rule.event === context.event)
    .filter((rule) => {
      try {
        return rule.condition(context);
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.priority - a.priority);

const preview = (steps: string[]): ExecutionPreviewStep[] =>
  steps.map((description, index) => ({ id: `preview-${index + 1}`, description }));

// Plan DESCRIPTIVO por decision. Cada paso narra lo que DEBERIA pasar; nada
// de esto se corre ni se encola contra sistemas reales.
export const buildExecutionPreview = (
  decision: AutomationDecision,
  customerId?: string,
): ExecutionPreviewStep[] => {
  const target = customerId ? ` para cliente ${customerId}` : '';
  switch (decision) {
    case 'REQUEST_SUSPENSION':
      return preview([
        `Actualizar Service Status${target} a suspension pendiente (propuesta).`,
        'Crear Provisioning de suspension para revision operativa.',
        'Notificar al cliente sobre el adeudo.',
        'Esperar aprobacion manual antes de cualquier cambio real.',
      ]);
    case 'REQUEST_REACTIVATION':
      return preview([
        `Validar que el cliente${target} no tenga bloqueo financiero activo.`,
        'Actualizar Service Status a reactivacion pendiente (propuesta).',
        'Crear Provisioning de reactivacion para revision operativa.',
        'Esperar aprobacion manual.',
      ]);
    case 'REQUEST_PLAN_CHANGE':
      return preview([
        `Validar el plan destino${target}.`,
        'Recalcular MRR proyectado (descriptivo).',
        'Crear Provisioning de cambio de plan para revision operativa.',
        'Esperar aprobacion manual.',
      ]);
    case 'CREATE_PROVISIONING':
      return preview([
        `Preparar accion de Provisioning${target} en estado PENDING.`,
        'Adjuntar plan descriptivo y origen Automation.',
        'Esperar validacion y aprobacion manual.',
      ]);
    case 'REQUEST_IP_ASSIGNMENT':
      return preview([
        'Consultar IPAM por una IP disponible (solo lectura).',
        `Proponer la asignacion de IP${target}.`,
        'Esperar confirmacion manual de la asignacion.',
      ]);
    case 'REQUEST_INSTALLATION':
      return preview([
        `Proponer agendar instalacion${target}.`,
        'Verificar reserva de equipo e inventario (solo lectura).',
        'Esperar asignacion de cuadrilla y confirmacion manual.',
      ]);
    case 'REQUEST_NOTIFICATION':
      return preview([
        `Preparar notificacion${target} (descriptiva).`,
        'Seleccionar plantilla de comunicacion sugerida.',
        'Esperar envio manual o integracion futura.',
      ]);
    case 'REQUEST_REVIEW':
      return preview([
        `Marcar el caso${target} para revision manual.`,
        'Adjuntar contexto descriptivo del evento.',
        'Esperar decision de un operador.',
      ]);
    case 'NOTHING':
    default:
      return preview(['Sin accion sugerida. El evento no requiere decision.']);
  }
};

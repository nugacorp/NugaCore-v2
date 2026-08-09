import { Router } from 'express';
import { Client, OnuFTTH } from '../../../src/types';
import { store } from '../../../backend/state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { paginateArray, parsePaginationOptional } from '../../common/pagination';
import { getCustomersService, parseClientStatus, parseClientType } from './service';
import { getPlansService } from '../plans/service';
import { getBillingService } from '../billing/service';
import { requestReactivation, requestSuspension } from '../service-status/service';
import { ipamService } from '../ipam/service';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getNetworkService } from '../network/service';

import { getFtthService } from '../network/ftth-service';
import { provisioningService } from '../provisioning/service';
import { buildCustomerMikrotikPlanSteps } from '../provisioning/customer-mikrotik-plan';
import { logger } from '../../common/logger';

const slugUser = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'cliente';

const dueDateFromZoneDay = (billingCycleDay?: number): string => {
  const now = new Date();
  if (!billingCycleDay || billingCycleDay < 1 || billingCycleDay > 31) {
    return new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  }
  const year = now.getFullYear();
  const month = now.getMonth();
  // Próximo día de corte de la zona (si ya pasó este mes → mes siguiente).
  let candidate = new Date(year, month, Math.min(billingCycleDay, 28));
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(year, month + 1, Math.min(billingCycleDay, 28));
  }
  return candidate.toISOString().substring(0, 10);
};

const router = Router();

// Persistencia detrás de feature flag USE_DB_CUSTOMERS (store mock | Supabase).
// El contrato de API v1 (rutas, payloads, formas de respuesta) NO cambia.
// Los efectos cruzados con otros dominios (facturas, ONUs, logs MikroTik,
// alertas) NO están migrados y siguen operando contra el store en ambos modos.

router.get('/api/clients', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const status = parseClientStatus(req.query.status);
  const type = parseClientType(req.query.type);
  const city = String(req.query.city || '').trim().toLowerCase();
  const planId = String(req.query.planId || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();
  const tenantId = tenantIdFromRequest(req);

  const rows = await getCustomersService().list({ status, type, city, planId, q, tenantId });
  const pagination = parsePaginationOptional(req.query as Record<string, unknown>);
  if (pagination) {
    res.json(paginateArray(rows, pagination));
    return;
  }
  res.json(rows);
}));

router.get('/api/clients/:id/history', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const events = await getCustomersService().getHistory(req.params.id);
  res.json(events);
}));

router.get('/api/clients/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  const client = await getCustomersService().getById(req.params.id, tenantId);
  if (!client) {
    return res.status(404).json({ error: 'Customer not found' });
  }
  res.json(client);
}));

router.post('/api/clients', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), asyncHandler(async (req, res) => {
  const service = getCustomersService();
  const {
    name,
    type,
    email,
    phone,
    address,
    city,
    planId,
    lat,
    lng,
    isConvertLead,
    leadId,
    notes,
    connectionType,
    routerId,
    poolId,
    assignedIp,
    equipmentReservationId,
    mac,
    billingZoneId,

    napId,
    napPort,
  } = req.body;

  // Validación de entrada (lanza 400 si es inválida).
  const { type: clientType } = service.validateCreate({ name, type, address, city, email });

  const planExists = await getPlansService().getById(planId || 'plan-basic', tenantIdFromRequest(req));
  if (!planExists) {
    return res.status(400).json({ error: 'Plan not found' });
  }

  const tenantId = tenantIdFromRequest(req);
  const requestedStatus = parseClientStatus(req.body.status);
  const randomSub = Math.floor(Math.random() * 253) + 2;
  const zoneId = String(billingZoneId || '').trim();
  let zoneProfile: Awaited<ReturnType<ReturnType<typeof getNetworkService>['getTowerOnboarding']>> = null;
  if (zoneId) {
    zoneProfile = await getNetworkService().getTowerOnboarding(zoneId, tenantId);
  }

  // Si eligen zona con router vinculado y no mandan routerId, usar el de la zona.
  const normalizedRouterId = String(routerId || zoneProfile?.routerId || '').trim();
  const normalizedPoolId = String(poolId || '').trim();
  const normalizedAssignedIp = String(assignedIp || '').trim();
  const networkAssignmentProvided = Boolean(
    normalizedRouterId || normalizedPoolId || normalizedAssignedIp,
  );

  let validatedAssignment:
    | Awaited<ReturnType<typeof ipamService.validateIp>>
    | null = null;

  // Compatibilidad: callers legacy que todavía no envían asignación de red
  // conservan su contrato actual. En cuanto un caller inicia el flujo IPAM,
  // los tres campos se vuelven obligatorios y el backend revalida disponibilidad
  // para impedir bypass o una selección obsoleta del frontend.
  if (networkAssignmentProvided) {
    if (!normalizedRouterId || !normalizedPoolId || !normalizedAssignedIp) {
      return res.status(400).json({
        error: 'routerId, poolId and assignedIp are required for network assignment',
        code: 'IPAM_ASSIGNMENT_INCOMPLETE',
      });
    }
    validatedAssignment = await ipamService.validateIp({
      routerId: normalizedRouterId,
      poolId: normalizedPoolId,
      ip: normalizedAssignedIp,
    });
    if (!validatedAssignment.available) {
      return res.status(409).json({
        error: validatedAssignment.message,
        code: `IPAM_${validatedAssignment.status.toUpperCase()}`,
        validation: validatedAssignment,
      });
    }
  }

  const willBeActive = isConvertLead || (requestedStatus || 'active') === 'active';
  const needsAccessCreds = willBeActive && Boolean(validatedAssignment);
  const pppoeUser = needsAccessCreds
    ? `${slugUser(String(name))}_${randomSub}`
    : isConvertLead
      ? `${slugUser(String(name))}_nuga`
      : undefined;
  const pppoePassword = needsAccessCreds || isConvertLead
    ? `Nc${randomSub}${Math.random().toString(36).slice(2, 8)}`
    : undefined;

  const newClient: Client = {
    id: await service.generateClientId(),
    name,
    type: clientType,
    status: isConvertLead ? 'active' : requestedStatus || 'active',
    email: email || 'sin-correo@nuga.core',
    phone: phone || '',
    address: address || '',
    city: city || 'CDMX',
    lat: Number(lat) || 19.4125,
    lng: Number(lng) || -99.1555,
    planId: planId || 'plan-basic',
    tenantId,
    billingZoneId: zoneId || undefined,
    connectionType: connectionType || (clientType === 'corporate' || clientType === 'hotel' ? 'FTTH' : 'WISP'),
    ip: validatedAssignment?.ip || (isConvertLead ? `10.100.10.${randomSub}` : '0.0.0.0'),
    ...(validatedAssignment
      ? {
          routerId: validatedAssignment.routerId,
          poolId: validatedAssignment.poolId,
          assignedIp: validatedAssignment.ip,
          ipAssignmentStatus: validatedAssignment.status,
        }
      : {}),
    equipmentReservationId: equipmentReservationId ? String(equipmentReservationId) : undefined,
    mac: mac
      ? String(mac).trim().toUpperCase()
      : isConvertLead
        ? `00:1A:79:A1:BA:${randomSub.toString(16).toUpperCase().padStart(2, '0')}`
        : undefined,
    pppoeUser,
    pppoePassword,
    contractId: isConvertLead ? `CONT-2026-${120 + store.CLIENTS.length}` : undefined,
    installationDate: isConvertLead || willBeActive
      ? new Date().toISOString().substring(0, 10)
      : undefined,
    notes: notes || '',
  };

  await service.create(newClient);
  await service.addTimelineEvent({
    clientId: newClient.id,
    eventType: 'created',
    summary: 'Cliente registrado en CRM',
    details: `Alta de cliente con estatus ${newClient.status}, plan ${newClient.planId}`
      + (zoneProfile?.zoneName ? ` y zona ${zoneProfile.zoneName}` : '')
      + '.',
    createdBy: req.authContext?.userId,
  });

  if (isConvertLead && leadId) {
    // El lead original (cliente) se elimina vía service (DB cascada el timeline).
    await service.remove(leadId, tenantId);
    store.createAlert('client', 'info', name, 'Lead convertido exitosamente a Cliente.');
    await service.addTimelineEvent({
      clientId: newClient.id,
      eventType: 'lead_conversion',
      summary: 'Lead convertido a cliente activo',
      details: `${name} fue convertido a cliente con contrato inicial.`,
      createdBy: req.authContext?.userId,
    });
  }

  // Factura inicial: conversión de lead, o alta activa con zona (corte real).
  if (isConvertLead || (willBeActive && zoneId)) {
    const plan = planExists;
    const cost = plan.price;
    const dueDateStr = dueDateFromZoneDay(zoneProfile?.billingCycleDay);
    await getBillingService().createInvoice({
      clientId: newClient.id,
      clientName: newClient.name,
      amount: cost,
      dueDateStr,
      items: [{
        description: `Mensualidad ${plan.name}`
          + (zoneProfile?.zoneName ? ` · zona ${zoneProfile.zoneName}` : ''),
        price: cost,
        qty: 1,
      }],
      tenantId,
    });
  }

  if (isConvertLead && !isDomainOnDb('customers') && (newClient.type === 'residential' || newClient.type === 'school')) {
    const newOnu: OnuFTTH = {
      id: store.getUniqueOnuId(),
      clientId: newClient.id,
      clientName: newClient.name,
      oltId: 'olt-1',
      port: 1,
      mac: `HWTCA${randomSub}BBCC`,
      signalDb: -20.5,
      status: 'online',
      brand: 'Huawei',
      model: 'EG8145V5',
    };
    store.ONUS.push(newOnu);
  }

  // Encola provisión MikroTik (dry-run por defecto; live solo con PROVISIONING_EXECUTE).
  if (willBeActive && validatedAssignment && newClient.routerId) {
    try {
      const steps = buildCustomerMikrotikPlanSteps({
        client: newClient,
        plan: planExists,
        zoneName: zoneProfile?.zoneName,
        billingCycleDay: zoneProfile?.billingCycleDay,
        billingCycleTime: zoneProfile?.billingCycleTime,
        routerName: zoneProfile?.routerName,
      });
      const action = provisioningService.createAction({
        actionType: 'CREATE_CUSTOMER',
        customerId: newClient.id,
        customerName: newClient.name,
        targetPlanId: planExists.id,
        targetPlanName: planExists.name,
        decisionSource: 'CRM',
        notes: steps.join('\n'),
      }, req.authContext?.userId || 'system');
      // Autovalida + simula para dejar lista la acción (approve sigue siendo humano/gate).
      provisioningService.validateAction(action.id, req.authContext?.userId || 'system');
      provisioningService.simulateAction(action.id, req.authContext?.userId || 'system');
      store.MIKROTIK_LOGS.push({
        tenantId,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `provisioning,info CREATE_CUSTOMER queued for ${newClient.pppoeUser || newClient.id} on ${newClient.routerId} plan=${planExists.name}`,
      });
    } catch (err) {
      logger.warn('No se pudo encolar provisioning CREATE_CUSTOMER', {

        clientId: newClient.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // FTTH: ocupar puerto NAP + registrar ONU (best-effort).
  const normalizedNapId = String(napId || '').trim();
  const normalizedNapPort = Number(napPort);
  if (
    String(connectionType || newClient.connectionType || '').toUpperCase() === 'FTTH'
    && normalizedNapId
    && Number.isFinite(normalizedNapPort)
    && normalizedNapPort > 0
  ) {
    try {
      await getFtthService().updateNapPort(normalizedNapId, normalizedNapPort, {
        status: 'occupied',
        client: newClient.name,
      });
      const newOnu: OnuFTTH = {
        id: store.getUniqueOnuId(),
        clientId: newClient.id,
        clientName: newClient.name,
        oltId: 'olt-pending',
        port: normalizedNapPort,
        mac: String(mac || newClient.mac || '00:00:00:00:00:00'),
        signalDb: -22,
        status: 'online',
        brand: 'Generic',
        model: 'ONT',
        napId: normalizedNapId,
        napPort: normalizedNapPort,
      };
      store.ONUS.push(newOnu);
    } catch (err) {
      logger.warn('No se pudo asignar NAP/ONU en alta FTTH', {
        clientId: newClient.id,
        napId: normalizedNapId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.status(201).json(newClient);
}));

router.put('/api/clients/:id', requireRoles(['super admin', 'administrador', 'cobranza']), asyncHandler(async (req, res) => {
  const service = getCustomersService();
  const { id } = req.params;
  const tenantId = tenantIdFromRequest(req);

  const existing = await service.getById(id, tenantId);
  if (!existing) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  service.validateUpdate(req.body);

  const beforeStatus = existing.status;
  const requestedStatus = req.body.status ? parseClientStatus(req.body.status) : null;
  const nextStatus = requestedStatus || beforeStatus;

  if (req.body.planId) {
    const plan = await getPlansService().getById(req.body.planId);
    if (!plan) {
      return res.status(400).json({ error: 'Plan not found' });
    }
  }

  // No permitir mover tenant desde el payload del cliente.
  const { tenantId: _ignoredTenant, ...bodyPatch } = req.body as Record<string, unknown>;
  const updated = await service.update(id, { ...bodyPatch, status: nextStatus }, tenantId);
  if (!updated) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (nextStatus === 'suspended' && beforeStatus !== 'suspended') {
    await requestSuspension(
      id,
      'Suspensión por cambio administrativo en CRM.',
      req.authContext?.role ?? null,
    );
  } else if (nextStatus === 'active' && beforeStatus !== 'active') {
    await requestReactivation(
      id,
      'Reactivación por cambio administrativo en CRM.',
      req.authContext?.role ?? null,
    );
  }

  await service.addTimelineEvent({
    clientId: updated.id,
    eventType: beforeStatus !== nextStatus ? 'status_change' : 'updated',
    summary: beforeStatus !== nextStatus ? `Cambio de estatus ${beforeStatus} -> ${nextStatus}` : 'Datos de cliente actualizados',
    details: `Actualizacion aplicada sobre ${updated.name}.`,
    createdBy: req.authContext?.userId,
  });

  res.json(updated);
}));

router.delete('/api/clients/:id', requireRoles(['super admin', 'administrador']), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const tenantId = tenantIdFromRequest(req);
  const removed = await getCustomersService().remove(id, tenantId);
  if (!removed) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (!isDomainOnDb('billing')) {
    store.INVOICES = store.INVOICES.filter((i) => i.clientId !== id);
  }
  if (!isDomainOnDb('customers')) {
    store.ONUS = store.ONUS.filter((o) => o.clientId !== id);
  }

  res.status(204).send();
}));

export default router;

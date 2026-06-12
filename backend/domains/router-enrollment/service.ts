// ====================================================================
// Servicio de Router Enrollment (Fase 4.7).
//
// Orquesta: crear router → asignar peer WireGuard → generar script .rsc
// con credenciales incrustadas → entregar script UNA vez → confirmar
// online via Worker read-only.
//
// RESTRICCIONES:
//  - NO commit mode. NO comandos reales al router.
//  - Script NUNCA persistido. Solo scriptHash para auditoría.
//  - Worker usado solo para lectura (readRouterSnapshot).
// ====================================================================

import { logger } from '../../common/logger';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { generateFromTemplate } from '../routeros-templates/generator';
import { buildTemplateFilename } from '../routeros-templates/validators';
import { store } from '../../state/store';
import { readRouterSnapshot } from '../mikrotik/worker/worker';
import { getWireguardService } from '../wireguard/service';
import { enrollmentRepository } from './repository';
import {
  CheckOnlineResult,
  EnrollmentStatus,
  ENROLLMENT_STATUS_LABELS,
  RouterEnrollmentRecord,
  RouterEnrollmentView,
  StartEnrollmentInput,
  StartEnrollmentResult,
} from './types';

const nowIso = () => new Date().toISOString();
const MAX_CHECK_ATTEMPTS = 10;

const toView = (rec: RouterEnrollmentRecord): RouterEnrollmentView => {
  const router = store.MIKROTIK_ROUTERS.find((r) => r.id === rec.routerId);
  return {
    id: rec.id,
    routerId: rec.routerId,
    routerName: router?.name,
    wgServerId: rec.wgServerId,
    wgPeerId: rec.wgPeerId,
    enrolledBy: rec.enrolledBy,
    status: rec.status,
    statusLabel: ENROLLMENT_STATUS_LABELS[rec.status],
    scriptHash: rec.scriptHash,
    scriptDownloadedAt: rec.scriptDownloadedAt,
    checkOnlineAttempts: rec.checkOnlineAttempts,
    lastCheckAt: rec.lastCheckAt,
    onlineConfirmedAt: rec.onlineConfirmedAt,
    failureReason: rec.failureReason,
    revokedAt: rec.revokedAt,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
};

// ── Generación del script ────────────────────────────────────────────

const buildScript = async (
  routerId: string,
  input: StartEnrollmentInput,
  actorId: string,
): Promise<{
  script: string;
  scriptFilename: string;
  scriptHash: string;
  wgPeerId: string;
  wgAssignedIp: string;
  wgServerPublicKey: string;
}> => {
  const wgService = getWireguardService();

  const peerConfig = await wgService.getPeerConfigForRouter(routerId, input.wgServerId, actorId);

  const routerIpWithoutMask = peerConfig.assignedIp.replace(/\/\d+$/, '');

  const resource = generateFromTemplate({
    templateId: 'router_base_wireguard',
    routerName: input.routerName,
    routerosVersion: input.routerosVersion,
    wgServerPublicKey: peerConfig.serverPublicKey,
    wgEndpoint: peerConfig.serverEndpoint,
    wgRouterIp: peerConfig.assignedIp,
    wgManagementCidr: peerConfig.allowedCidr,
    wgVpnCidr: peerConfig.allowedCidr,
    wgPrivateKey: peerConfig.privateKey,
    wgKeepalive: 25,
    lanBridgeName: input.lanBridgeName,
    lanCidr: input.lanCidr,
    lanGateway: input.lanGateway,
    wanInterface: input.wanInterface,
  });

  const filename = buildTemplateFilename(input.routerName, 'router_base_wireguard');

  logger.info('Enrollment: script generado', {
    routerId,
    peerId: peerConfig.peer.id,
    scriptHash: resource.scriptHash,
    filename,
    // NUNCA loguear el script ni las claves
  });

  return {
    script: resource.script,
    scriptFilename: filename,
    scriptHash: resource.scriptHash,
    wgPeerId: peerConfig.peer.id,
    wgAssignedIp: routerIpWithoutMask,
    wgServerPublicKey: peerConfig.serverPublicKey,
  };
};

// ── API pública ──────────────────────────────────────────────────────

export const enrollmentService = {
  /** Crea router + peer WG + script. El script se devuelve UNA vez y no se persiste. */
  async start(input: StartEnrollmentInput, actorId: string): Promise<StartEnrollmentResult> {
    if (!input.routerName?.trim()) throw new BadRequestError('routerName es obligatorio.');
    if (!input.wgServerId?.trim()) throw new BadRequestError('wgServerId es obligatorio.');
    if (!input.routerosVersion) throw new BadRequestError('routerosVersion es obligatorio.');

    const routerId = store.getUniqueMikrotikRouterId();
    store.MIKROTIK_ROUTERS.push({
      id: routerId,
      name: input.routerName.trim(),
      ipAddress: input.ipAddress || '0.0.0.0',
      apiPort: input.apiPort || 8728,
      username: '',
      encryptedPassword: '',
      isOnline: false,
      cpuUsagePct: 0,
      memoryUsagePct: 0,
      routerOsVersion: 'unknown',
      linkedTowerId: input.linkedTowerId,
      lastHealthCheckAt: nowIso(),
      connectionType: 'wireguard',
      provisioningStatus: 'pending',
      notes: input.notes,
    });

    const { script, scriptFilename, scriptHash, wgPeerId, wgAssignedIp, wgServerPublicKey } =
      await buildScript(routerId, input, actorId);

    const id = enrollmentRepository.nextId();
    const rec: RouterEnrollmentRecord = {
      id,
      routerId,
      wgServerId: input.wgServerId,
      wgPeerId,
      enrolledBy: actorId,
      status: 'script_generated',
      scriptHash,
      checkOnlineAttempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    enrollmentRepository.create(rec);

    logger.info('Enrollment iniciado', { enrollmentId: id, routerId, wgPeerId });

    return {
      enrollment: toView(rec),
      routerId,
      wgPeerId,
      wgAssignedIp,
      wgServerPublicKey,
      script,
      scriptFilename,
      scriptHash,
      securityWarning:
        'Este script contiene claves privadas WireGuard. ' +
        'Guárdalo de forma segura, úsalo UNA VEZ y elimínalo del dispositivo tras importarlo.',
    };
  },

  list(): RouterEnrollmentView[] {
    return enrollmentRepository.list().map(toView);
  },

  getById(id: string): RouterEnrollmentView | null {
    const rec = enrollmentRepository.getById(id);
    return rec ? toView(rec) : null;
  },

  /**
   * Re-genera y devuelve el script para descarga. Actualiza downloaded_at y
   * avanza el estado a script_downloaded.
   * El script NO se persiste: se re-genera usando las mismas claves WG cifradas.
   */
  async download(
    id: string,
    actorId: string,
  ): Promise<{ script: string; filename: string; enrollment: RouterEnrollmentView } | null> {
    const rec = enrollmentRepository.getById(id);
    if (!rec) return null;

    if (rec.status === 'revoked') throw new BadRequestError('El enrollment ha sido revocado.');
    if (rec.status === 'online') throw new BadRequestError('El router ya está online; no se requiere re-descarga.');

    const router = store.MIKROTIK_ROUTERS.find((r) => r.id === rec.routerId);
    if (!router) throw new NotFoundError('Router no encontrado.');

    const input: StartEnrollmentInput = {
      routerName: router.name,
      ipAddress: router.ipAddress,
      apiPort: router.apiPort,
      linkedTowerId: router.linkedTowerId,
      wgServerId: rec.wgServerId,
      routerosVersion: '7',
      notes: router.notes,
    };

    const { script, scriptFilename } = await buildScript(rec.routerId, input, actorId);

    const updated = enrollmentRepository.update(id, {
      scriptDownloadedAt: nowIso(),
      status: rec.status === 'script_generated' ? 'script_downloaded' : rec.status,
    });

    logger.info('Enrollment: script descargado', {
      enrollmentId: id,
      // NO loguear script ni claves
    });

    return { script, filename: scriptFilename, enrollment: toView(updated!) };
  },

  /** Lectura read-only via Worker para confirmar que el router está online. */
  async checkOnline(id: string): Promise<CheckOnlineResult> {
    const rec = enrollmentRepository.getById(id);
    if (!rec) throw new NotFoundError('Enrollment no encontrado.');

    if (rec.status === 'online') {
      return {
        enrollment: toView(rec),
        isOnline: true,
        snapshotSource: null,
        message: 'El router ya está confirmado como online.',
      };
    }
    if (rec.status === 'revoked') throw new BadRequestError('El enrollment ha sido revocado.');
    if (rec.status === 'failed') throw new BadRequestError('El enrollment está en estado fallido.');

    const snapshot = await readRouterSnapshot(rec.routerId);
    const attempts = rec.checkOnlineAttempts + 1;

    if (snapshot && snapshot.reads.some((r) => r.ok)) {
      const router = store.MIKROTIK_ROUTERS.find((r) => r.id === rec.routerId);
      if (router) {
        router.isOnline = true;
        router.provisioningStatus = 'connected';
        router.lastSeenAt = nowIso();
        router.lastHealthCheckAt = nowIso();
      }

      const updated = enrollmentRepository.update(id, {
        status: 'online',
        onlineConfirmedAt: nowIso(),
        checkOnlineAttempts: attempts,
        lastCheckAt: nowIso(),
      });

      logger.info('Enrollment: router confirmado online', {
        enrollmentId: id,
        routerId: rec.routerId,
        source: snapshot.source,
      });

      return {
        enrollment: toView(updated!),
        isOnline: true,
        snapshotSource: snapshot.source,
        message: `Router online confirmado (fuente: ${snapshot.source}).`,
      };
    }

    const nextStatus: EnrollmentStatus =
      attempts > MAX_CHECK_ATTEMPTS ? 'failed' : 'waiting_for_router';
    const failureReason =
      nextStatus === 'failed'
        ? `Sin respuesta tras ${attempts} intentos. Verifica que el script fue importado correctamente.`
        : undefined;

    const updated = enrollmentRepository.update(id, {
      status: nextStatus,
      checkOnlineAttempts: attempts,
      lastCheckAt: nowIso(),
      failureReason,
    });

    return {
      enrollment: toView(updated!),
      isOnline: false,
      snapshotSource: null,
      message:
        nextStatus === 'failed'
          ? `Enrollment fallido tras ${attempts} intentos.`
          : `Router aún no responde. Intento ${attempts}/${MAX_CHECK_ATTEMPTS}.`,
    };
  },

  /** Revoca el peer WireGuard y marca el enrollment como revocado. */
  async revoke(id: string, actorId: string): Promise<RouterEnrollmentView | null> {
    const rec = enrollmentRepository.getById(id);
    if (!rec) return null;

    if (rec.status === 'revoked') throw new BadRequestError('El enrollment ya está revocado.');

    const wgService = getWireguardService();
    await wgService.revokePeer(rec.wgPeerId);

    const router = store.MIKROTIK_ROUTERS.find((r) => r.id === rec.routerId);
    if (router) {
      router.isOnline = false;
      router.provisioningStatus = 'error';
    }

    const updated = enrollmentRepository.update(id, {
      status: 'revoked',
      revokedAt: nowIso(),
      revokedBy: actorId,
    });

    logger.info('Enrollment revocado', {
      enrollmentId: id,
      routerId: rec.routerId,
      wgPeerId: rec.wgPeerId,
      revokedBy: actorId,
    });

    return toView(updated!);
  },
};

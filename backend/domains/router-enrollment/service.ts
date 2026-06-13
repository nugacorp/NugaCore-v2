// ====================================================================
// Servicio de Router Enrollment (Fase 4.7 + Hotfix Hermes).
//
// Orquesta: crear router → asignar peer WireGuard → generar script .rsc
// con credenciales incrustadas → entregar script UNA vez → confirmar
// online via Worker read-only (solo source=live confirma online).
//
// RESTRICCIONES:
//  - NO commit mode. NO comandos reales al router.
//  - Script NUNCA persistido. Solo scriptHash para auditoría.
//  - Worker usado solo para lectura (readRouterSnapshot).
//  - Solo source=live puede marcar enrollment como online.
// ====================================================================

import { logger } from '../../common/logger';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { generateFromTemplate } from '../routeros-templates/generator';
import { buildTemplateFilename } from '../routeros-templates/validators';
import { store } from '../../state/store';
import { readRouterSnapshot } from '../mikrotik/worker/worker';
import { isLiveWorkerEnabled } from '../mikrotik/worker/connector';
import { getWireguardService } from '../wireguard/service';
import { enrollmentRepository } from './repository';
import { resolveTemplateParams, validateEnrollmentTemplateId, getTemplateMetadata } from './template-mapper';
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
  // templateName / generatorVersion se derivan del templateId (no se persisten).
  const { templateName, generatorVersion } = getTemplateMetadata(rec.templateId);
  return {
    id: rec.id,
    routerId: rec.routerId,
    routerName: router?.name,
    wgServerId: rec.wgServerId,
    wgPeerId: rec.wgPeerId,
    enrolledBy: rec.enrolledBy,
    status: rec.status,
    statusLabel: ENROLLMENT_STATUS_LABELS[rec.status],
    routerosVersion: rec.routerosVersion,
    templateId: rec.templateId,
    templateName,
    generatorVersion,
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

// ── Script helpers ───────────────────────────────────────────────────

/**
 * Genera un preview saneado del script.
 * Elimina completamente los pares key=value secretos — incluyendo el nombre
 * de la clave — reemplazándolos por marcadores que NO contienen "private-key=",
 * "preshared-key=" ni "password=". El public-key del servidor se conserva.
 */
const buildScriptPreview = (script: string): string =>
  script
    .replace(/private-key="[^"]*"/gi, '<PRIVATE_KEY_OMITIDA>')
    .replace(/private-key=[^\s\\\n"]+/gi, '<PRIVATE_KEY_OMITIDA>')
    .replace(/preshared-key="[^"]*"/gi, '<PRESHARED_KEY_OMITIDA>')
    .replace(/preshared-key=[^\s\\\n"]+/gi, '<PRESHARED_KEY_OMITIDA>')
    .replace(/password="[^"]*"/gi, '<PASSWORD_OMITIDO>')
    .replace(/password=[^\s\\\n"]+/gi, '<PASSWORD_OMITIDO>');

const buildScript = async (
  routerId: string,
  input: StartEnrollmentInput,
  wgServerId: string,
  actorId: string,
): Promise<{
  script: string;
  scriptFilename: string;
  scriptHash: string;
  templateId: string;
  templateName: string;
  generatorVersion: string;
  wgPeerId: string;
  wgAssignedIp: string;
  wgServerPublicKey: string;
}> => {
  const wgService = getWireguardService();

  // Siempre se crea/reutiliza el peer WG para management NugaCore.
  const peerConfig = await wgService.getPeerConfigForRouter(routerId, wgServerId, actorId);
  const routerIpWithoutMask = peerConfig.assignedIp.replace(/\/\d+$/, '');

  // Resuelve templateId con fallback a router_base_wireguard (backward compat).
  const effectiveTemplateId = input.templateId?.trim() || 'router_base_wireguard';

  const resolved = resolveTemplateParams(effectiveTemplateId, input, peerConfig);
  const resource = generateFromTemplate(resolved.params);
  const filename = buildTemplateFilename(input.routerName, resolved.libraryId);

  logger.info('Enrollment: script generado', {
    routerId,
    peerId: peerConfig.peer.id,
    templateId: resolved.libraryId,
    templateName: resolved.templateName,
    scriptHash: resource.scriptHash,
    filename,
    // NUNCA loguear el script ni las claves
  });

  return {
    script: resource.script,
    scriptFilename: filename,
    scriptHash: resource.scriptHash,
    templateId: resolved.libraryId,
    templateName: resolved.templateName,
    generatorVersion: resolved.generatorVersion,
    wgPeerId: peerConfig.peer.id,
    wgAssignedIp: routerIpWithoutMask,
    wgServerPublicKey: peerConfig.serverPublicKey,
  };
};

// ── API pública ──────────────────────────────────────────────────────

export const enrollmentService = {
  /**
   * Crea router + peer WG + script.
   * El script se devuelve UNA vez y no se persiste.
   * Si wgServerId se omite, usa el servidor WireGuard default del VPS.
   */
  async start(input: StartEnrollmentInput, actorId: string): Promise<StartEnrollmentResult> {
    // ── 1. Validar input básico ──────────────────────────────────────
    if (!input.routerName?.trim()) throw new BadRequestError('routerName es obligatorio.');
    if (!input.routerosVersion) throw new BadRequestError('routerosVersion es obligatorio.');

    // ── 2. Validar templateId ANTES de tocar WireGuard ───────────────
    // Crítico: si el templateId es inválido debe fallar aquí, sin crear ni
    // reutilizar un peer WireGuard (evita peers huérfanos en el servidor).
    const effectiveTemplateId = input.templateId?.trim() || 'router_base_wireguard';
    validateEnrollmentTemplateId(effectiveTemplateId);

    // ── 3-4. Resolver servidor WireGuard ─────────────────────────────
    const wgService = getWireguardService();
    let resolvedServerId: string;

    if (input.wgServerId?.trim()) {
      resolvedServerId = input.wgServerId.trim();
      // Validar que existe: 404 en lugar de 500
      const server = await wgService.findServer(resolvedServerId);
      if (!server) {
        throw new NotFoundError(`Servidor WireGuard '${resolvedServerId}' no encontrado.`);
      }
    } else {
      const defaultServer = await wgService.getDefaultServer();
      if (!defaultServer) {
        throw new BadRequestError(
          'No hay servidor WireGuard default configurado. ' +
          'Crea un servidor con isDefault=true antes de iniciar un enrollment.',
        );
      }
      resolvedServerId = defaultServer.id;
    }

    // ── Generar router ID (sin push aún) ─────────────────────────────
    const routerId = store.getUniqueMikrotikRouterId();

    let buildResult: Awaited<ReturnType<typeof buildScript>>;
    try {
      buildResult = await buildScript(routerId, input, resolvedServerId, actorId);
    } catch (err) {
      // Best-effort: revocar peer WG si fue creado antes del fallo
      try {
        const orphans = await wgService.listPeers({ serverId: resolvedServerId, routerId, status: 'active' });
        if (orphans.length > 0) {
          await wgService.revokePeer(orphans[0].id);
          logger.warn('Enrollment: peer WG huérfano revocado en rollback', {
            routerId,
            peerId: orphans[0].id,
          });
        }
      } catch (rollbackErr) {
        logger.warn('Enrollment: rollback de peer WG falló (best-effort)', {
          routerId,
          error: String(rollbackErr),
        });
      }
      throw err;
    }

    const { script, scriptFilename, scriptHash, templateId: resolvedTemplateId, templateName, generatorVersion, wgPeerId, wgAssignedIp, wgServerPublicKey } = buildResult;

    // Push al store SOLO tras buildScript exitoso → no hay router huérfano
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
      vpnIp: wgAssignedIp,
      notes: input.notes,
    });

    const id = enrollmentRepository.nextId();
    const rec: RouterEnrollmentRecord = {
      id,
      routerId,
      wgServerId: resolvedServerId,
      wgPeerId,
      enrolledBy: actorId,
      status: 'script_generated',
      routerosVersion: input.routerosVersion,
      templateId: resolvedTemplateId,
      scriptHash,
      checkOnlineAttempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    enrollmentRepository.create(rec);

    logger.info('Enrollment iniciado', {
      enrollmentId: id,
      routerId,
      wgPeerId,
      wgServerId: resolvedServerId,
      templateId: resolvedTemplateId,
    });

    const securityMsg =
      'Este script contiene claves privadas WireGuard. ' +
      'Guárdalo de forma segura, úsalo UNA VEZ y elimínalo del dispositivo tras importarlo.';

    return {
      // ── Aliases top-level (contrato Hermes) ──────────────────────
      enrollmentId: id,
      peerId: wgPeerId,
      assignedIp: wgAssignedIp,
      filename: scriptFilename,
      scriptPreview: buildScriptPreview(script),
      securityNotice: securityMsg,
      // ── Metadata de template (Fase 4.9.1) ───────────────────────
      templateId: resolvedTemplateId,
      templateName,
      generatorVersion,
      // ── Campos originales ────────────────────────────────────────
      enrollment: toView(rec),
      routerId,
      wgPeerId,
      wgAssignedIp,
      wgServerPublicKey,
      script,
      scriptFilename,
      scriptHash,
      securityWarning: securityMsg,
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
      routerosVersion: rec.routerosVersion,
      // Usa el templateId persistido en el record para regenerar el mismo script.
      templateId: rec.templateId,
      notes: router.notes,
    };

    const { script, scriptFilename } = await buildScript(rec.routerId, input, rec.wgServerId, actorId);

    const updated = enrollmentRepository.update(id, {
      scriptDownloadedAt: nowIso(),
      status: rec.status === 'script_generated' ? 'script_downloaded' : rec.status,
    });

    logger.info('Enrollment: script descargado', { enrollmentId: id });

    return { script, filename: scriptFilename, enrollment: toView(updated!) };
  },

  /**
   * Lectura read-only via Worker para confirmar que el router está online.
   * SOLO source=live puede marcar el enrollment como online.
   * source=simulated deja el enrollment en waiting_for_router.
   */
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

    // Solo source=live puede confirmar online
    if (snapshot && snapshot.source === 'live' && snapshot.reads.some((r) => r.ok)) {
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
        source: 'live',
      });

      return {
        enrollment: toView(updated!),
        isOnline: true,
        snapshotSource: 'live',
        message: 'Router online confirmado (fuente: live).',
      };
    }

    // No confirmado: simulated o sin snapshot
    const isSimulated = snapshot?.source === 'simulated';
    const nextStatus: EnrollmentStatus =
      attempts > MAX_CHECK_ATTEMPTS ? 'failed' : 'waiting_for_router';
    const failureReason =
      nextStatus === 'failed'
        ? `Sin confirmación live tras ${attempts} intentos.`
        : undefined;

    const updated = enrollmentRepository.update(id, {
      status: nextStatus,
      checkOnlineAttempts: attempts,
      lastCheckAt: nowIso(),
      failureReason,
    });

    let message: string;
    if (nextStatus === 'failed') {
      message = `Enrollment fallido: sin confirmación live tras ${attempts} intentos.`;
    } else if (isSimulated) {
      message = isLiveWorkerEnabled()
        ? `Lectura simulada (live falló con fallback). No se puede confirmar online. Intento ${attempts}/${MAX_CHECK_ATTEMPTS}.`
        : `MIKROTIK_WORKER_LIVE desactivado — lectura simulada. Solo source=live puede confirmar online. Intento ${attempts}/${MAX_CHECK_ATTEMPTS}.`;
    } else {
      message = `Router aún no responde. Intento ${attempts}/${MAX_CHECK_ATTEMPTS}.`;
    }

    return {
      enrollment: toView(updated!),
      isOnline: false,
      snapshotSource: snapshot?.source ?? null,
      message,
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

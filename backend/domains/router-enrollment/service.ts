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
import { deleteMikrotikRouter, persistMikrotikRouter } from '../mikrotik/repository';
import { generateApiCredential } from '../mikrotik/provisioning/credentials';
import { getWireguardService } from '../wireguard/service';
import type { PeerCreatedOnce, WireguardPeerView } from '../wireguard/types';
import { encryptSecret, decryptSecret } from '../../services/crypto';
import { getEnrollmentRepository } from './repository';
import {
  resolveTemplateParams,
  validateEnrollmentTemplateId,
  getTemplateMetadata,
  enrollmentTemplateNeedsWireguard,
} from './template-mapper';
import { validateTemplateParameters, redactSecretValues, applyDefaults, stripWireguardParameterOverrides } from '../router-template-parameters/validators';
import { mapParametersToLibraryParams } from '../router-template-parameters/mappers';
import {
  CheckOnlineResult,
  EnrollmentStatus,
  ENROLLMENT_STATUS_LABELS,
  RouterEnrollmentRecord,
  RouterEnrollmentRouterSnapshot,
  RouterEnrollmentWireGuardSnapshot,
  RouterEnrollmentWireGuardSnapshotView,
  RouterEnrollmentSnmpSnapshot,
  RouterEnrollmentSnmpSnapshotView,
  RouterEnrollmentView,
  StartEnrollmentInput,
  StartEnrollmentResult,
} from './types';

import { generateSnmpCommunity } from '../mikrotik/provisioning/snmp-credentials';
import { nowIso } from '../../common/time';
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
    // Parámetros con secretos (passwords PPPoE) redactados antes de exponerlos.
    templateParameters: rec.templateParameters
      ? redactSecretValues(rec.templateId, rec.templateParameters)
      : undefined,
    // Snapshot NO sensible del router (sin secretos por diseño): útil para la UI
    // y para diagnosticar regeneraciones tras restart.
    routerSnapshot: rec.routerSnapshot,
    // Snapshot WireGuard SANEADO: se eliminan los campos cifrados antes de exponer.
    wireguardSnapshot: sanitizeWgSnapshot(rec.wireguardSnapshot),
    snmpSnapshot: sanitizeSnmpSnapshot(rec.snmpSnapshot),
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
    .replace(/password=[^\s\\\n"]+/gi, '<PASSWORD_OMITIDO>')
    .replace(/name="nc-[a-f0-9]+"/gi, 'name="<SNMP_COMMUNITY_OMITIDA>"');

// ── WireGuard snapshot helpers (Fase 4.9.2 hotfix) ────────────────────

/** Quita los campos cifrados antes de exponer el snapshot WG por API/View. */
const sanitizeWgSnapshot = (
  snap?: RouterEnrollmentWireGuardSnapshot,
): RouterEnrollmentWireGuardSnapshotView | undefined => {
  if (!snap) return undefined;
  const { encryptedPeerPrivateKey: _p, encryptedPresharedKey: _k, ...safe } = snap;
  return safe;
};

const sanitizeSnmpSnapshot = (
  snap?: RouterEnrollmentSnmpSnapshot,
): RouterEnrollmentSnmpSnapshotView | undefined => {
  if (!snap) return undefined;
  const { encryptedCommunity: _c, ...safe } = snap;
  return safe;
};

const buildSnmpSnapshot = (community: string, mgmtCidr?: string): RouterEnrollmentSnmpSnapshot => ({
  version: '2c',
  mgmtCidr,
  hasEncryptedSecrets: true,
  encryptedCommunity: encryptSecret(community),
});

const reconstructSnmpCommunityFromSnapshot = (
  snap?: RouterEnrollmentSnmpSnapshot,
): string | null => {
  if (!snap?.encryptedCommunity) return null;
  return decryptSecret(snap.encryptedCommunity);
};

/**
 * Construye el snapshot WireGuard a persistir desde la config del peer creada en
 * start(). Datos públicos en claro; secretos CIFRADOS con encryptSecret (nunca
 * en claro). Solo se usa para plantillas que incrustan WireGuard.
 */
const buildWireguardSnapshot = (
  wgServerId: string,
  pc: PeerCreatedOnce,
): RouterEnrollmentWireGuardSnapshot => {
  const idx = pc.serverEndpoint.lastIndexOf(':');
  const endpointHost = idx >= 0 ? pc.serverEndpoint.slice(0, idx) : pc.serverEndpoint;
  const portNum = idx >= 0 ? Number(pc.serverEndpoint.slice(idx + 1)) : NaN;
  return {
    wgServerId,
    wgPeerId: pc.peer.id,
    serverPublicKey: pc.serverPublicKey,
    endpointHost,
    endpointPort: Number.isFinite(portNum) ? portNum : undefined,
    assignedIp: pc.assignedIp,
    allowedCidr: pc.allowedCidr,
    allowedIps: pc.allowedCidr ? [pc.allowedCidr] : undefined,
    persistentKeepalive: 25,
    hasEncryptedSecrets: Boolean(pc.privateKey),
    encryptedPeerPrivateKey: pc.privateKey ? encryptSecret(pc.privateKey) : undefined,
    encryptedPresharedKey: pc.presharedKey ? encryptSecret(pc.presharedKey) : undefined,
  };
};

/**
 * Reconstruye un PeerCreatedOnce desde el snapshot WG persistido (descifra los
 * secretos). Devuelve null si el snapshot no tiene lo mínimo para regenerar un
 * script WireGuard válido (servidor + IP + private key del peer).
 */
const reconstructPeerConfigFromSnapshot = (
  snap?: RouterEnrollmentWireGuardSnapshot,
): PeerCreatedOnce | null => {
  if (!snap || !snap.serverPublicKey || !snap.assignedIp) return null;
  const privateKey = snap.encryptedPeerPrivateKey ? decryptSecret(snap.encryptedPeerPrivateKey) : '';
  if (!privateKey) return null; // sin la private key no se puede regenerar un script WG válido
  const presharedKey = snap.encryptedPresharedKey ? decryptSecret(snap.encryptedPresharedKey) : '';
  const serverEndpoint =
    snap.endpointHost && snap.endpointPort
      ? `${snap.endpointHost}:${snap.endpointPort}`
      : snap.endpointHost ?? '';
  const peer: WireguardPeerView = {
    id: snap.wgPeerId ?? '',
    serverId: snap.wgServerId ?? '',
    name: '',
    publicKey: '',
    allocatedIp: snap.assignedIp.replace(/\/\d+$/, ''),
    allowedCidr: snap.allowedCidr,
    status: 'active',
    hasSecrets: true,
    createdAt: '',
  };
  return {
    peer,
    privateKey,
    presharedKey,
    serverPublicKey: snap.serverPublicKey,
    serverEndpoint,
    assignedIp: snap.assignedIp,
    allowedCidr: snap.allowedCidr ?? '',
  };
};

/**
 * Resuelve la config WireGuard para regenerar el script en /download SIN
 * depender del store en memoria: prioriza el snapshot cifrado (claves
 * originales) y, si no hay, intenta el store (WG aún en memoria). Si tampoco,
 * lanza WIREGUARD_SNAPSHOT_MISSING.
 */
const resolveWgForDownload = async (
  routerId: string,
  wgServerId: string,
  actorId: string,
  wgSnapshot?: RouterEnrollmentWireGuardSnapshot,
): Promise<PeerCreatedOnce> => {
  const fromSnap = reconstructPeerConfigFromSnapshot(wgSnapshot);
  if (fromSnap) return fromSnap;
  try {
    // Fallback: el WG store sigue en memoria y tiene el peer del router.
    return await getWireguardService().getPeerConfigForRouter(routerId, wgServerId, actorId);
  } catch {
    throw new NotFoundError(
      'No se puede regenerar el script WireGuard: el servidor/peer ya no está en ' +
        'memoria y no hay snapshot WireGuard suficiente. Vuelve a iniciar el enrollment.',
      'WIREGUARD_SNAPSHOT_MISSING',
    );
  }
};

interface BuildScriptResult {
  script: string;
  scriptFilename: string;
  scriptHash: string;
  templateId: string;
  templateName: string;
  generatorVersion: string;
  wgPeerId: string;
  wgAssignedIp: string;
  wgServerPublicKey: string;
  peerConfig: PeerCreatedOnce | null;
  snmpCommunity?: string;
  apiUsername?: string;
  apiEncryptedPassword?: string;
}

/**
 * Genera el script .rsc.
 *
 * Resolución de WireGuard según `mode`:
 *  - 'create' (start): SIEMPRE crea/reutiliza el peer de management NugaCore
 *    (todas las plantillas), conservando el comportamiento previo.
 *  - 'download': SOLO resuelve WireGuard si la plantilla incrusta WG en el
 *    script. Para plantillas no-WG (pcc_*, pppoe…) NO consulta el WG store, de
 *    modo que /download funciona tras un restart sin servidor/peer en memoria.
 *    Para plantillas WG usa el snapshot cifrado (o el store como fallback).
 */
const buildScript = async (
  routerId: string,
  input: StartEnrollmentInput,
  wgServerId: string,
  actorId: string,
  opts: {
    mode: 'create' | 'download';
    wgSnapshot?: RouterEnrollmentWireGuardSnapshot;
    snmpSnapshot?: RouterEnrollmentSnmpSnapshot;
  } = { mode: 'create' },
): Promise<BuildScriptResult> => {
  // Resuelve templateId con fallback a router_base_wireguard (backward compat).
  const effectiveTemplateId = input.templateId?.trim() || 'router_base_wireguard';
  const needsWg = enrollmentTemplateNeedsWireguard(effectiveTemplateId);

  let peerConfig: PeerCreatedOnce | null = null;
  if (opts.mode === 'create') {
    // start: siempre crea/reutiliza el peer WG de management (todas las plantillas).
    peerConfig = await getWireguardService().getPeerConfigForRouter(routerId, wgServerId, actorId);
  } else if (needsWg) {
    // download: solo resolver WG si el script lo incrusta (no-WG → sin lookup).
    peerConfig = await resolveWgForDownload(routerId, wgServerId, actorId, opts.wgSnapshot);
  }

  const resolved = resolveTemplateParams(effectiveTemplateId, input, peerConfig);

  // Fase 4.9.2: los parámetros dinámicos del Wizard sobrescriben los valores
  // base (solo las claves presentes; no clobbean con undefined).
  const dynamicParams = mapParametersToLibraryParams(effectiveTemplateId, input.templateParameters);
  const generatorParams = { ...resolved.params, ...dynamicParams };

  // Credenciales API: en create se generan y se persisten en mikrotik_routers;
  // en download se reutilizan (mismo user/pass que en el .rsc original).
  let apiUsername: string | undefined;
  let apiEncryptedPassword: string | undefined;
  if (opts.mode === 'create') {
    const apiCred = generateApiCredential(input.routerName);
    generatorParams.apiUsername = apiCred.username;
    generatorParams.apiPassword = apiCred.plainPassword;
    apiUsername = apiCred.username;
    apiEncryptedPassword = apiCred.encryptedPassword;
  } else {
    const existing = store.MIKROTIK_ROUTERS.find((r) => r.id === routerId);
    if (existing?.username && existing.encryptedPassword) {
      try {
        generatorParams.apiUsername = existing.username;
        generatorParams.apiPassword = decryptSecret(existing.encryptedPassword);
        apiUsername = existing.username;
        apiEncryptedPassword = existing.encryptedPassword;
      } catch (err) {
        logger.warn('Enrollment download: no se pudo descifrar password API; se regenera', {
          routerId,
          error: String(err),
        });
      }
    }
  }

  const needsSnmp = effectiveTemplateId === 'nugacore_factory_onboarding';
  let snmpCommunityPlain: string | undefined;
  if (needsSnmp) {
    if (opts.mode === 'download') {
      snmpCommunityPlain = reconstructSnmpCommunityFromSnapshot(opts.snmpSnapshot) ?? undefined;
      if (!snmpCommunityPlain) {
        throw new NotFoundError(
          'No se puede regenerar el script SNMP: no hay snapshot SNMP suficiente. Vuelve a iniciar el enrollment.',
          'SNMP_SNAPSHOT_MISSING',
        );
      }
    } else {
      snmpCommunityPlain = generateSnmpCommunity(input.routerName);
    }
    generatorParams.snmpCommunity = snmpCommunityPlain;
  }

  const resource = generateFromTemplate(generatorParams);
  const filename = buildTemplateFilename(input.routerName, resolved.libraryId);
  apiUsername = apiUsername || resource.apiUsername;
  apiEncryptedPassword = apiEncryptedPassword || resource.apiEncryptedPassword;

  logger.info('Enrollment: script generado', {
    routerId,
    peerId: peerConfig?.peer.id,
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
    wgPeerId: peerConfig?.peer.id ?? '',
    wgAssignedIp: peerConfig ? peerConfig.assignedIp.replace(/\/\d+$/, '') : '',
    wgServerPublicKey: peerConfig?.serverPublicKey ?? '',
    peerConfig,
    snmpCommunity: snmpCommunityPlain,
    apiUsername,
    apiEncryptedPassword,
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

    // ── 2b. Validar parámetros dinámicos (Fase 4.9.2) ────────────────
    // También antes de WireGuard: un parámetro inválido no debe dejar peer.
    // Se completan con defaults del esquema (config parcial permitida) y
    // se persiste el set completo para regenerar de forma determinista.
    let effectiveParams = input.templateParameters;
    if (input.templateParameters) {
      effectiveParams = stripWireguardParameterOverrides(
        applyDefaults(effectiveTemplateId, input.templateParameters),
      );
      const paramCheck = validateTemplateParameters(effectiveTemplateId, effectiveParams);
      if (!paramCheck.valid) {
        throw new BadRequestError(
          `Parámetros de plantilla inválidos: ${paramCheck.errors.join(' ')}`,
          'TEMPLATE_PARAMETERS_INVALID',
        );
      }
    }

    // ── 3-4. Resolver servidor WireGuard (siempre default VPS salvo override de tests) ──
    const allowWgServerOverride =
      (process.env.ENROLLMENT_WG_SERVER_OVERRIDE || '').trim().toLowerCase() === 'true';
    const wgService = getWireguardService();
    let resolvedServerId: string;

    if (allowWgServerOverride && input.wgServerId?.trim()) {
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

    // Input normalizado con parámetros completados (defaults aplicados).
    const enrollInput: StartEnrollmentInput = { ...input, templateParameters: effectiveParams };

    let buildResult: Awaited<ReturnType<typeof buildScript>>;
    try {
      buildResult = await buildScript(routerId, enrollInput, resolvedServerId, actorId);
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

    const {
      script,
      scriptFilename,
      scriptHash,
      templateId: resolvedTemplateId,
      templateName,
      generatorVersion,
      wgPeerId,
      wgAssignedIp,
      wgServerPublicKey,
      peerConfig,
      snmpCommunity,
      apiUsername,
      apiEncryptedPassword,
    } = buildResult;

    // Push al store SOLO tras buildScript exitoso → no hay router huérfano.
    // Credenciales API del .rsc se persisten cifradas para check-online live
    // y para regenerar el mismo password en /download.
    const enrolledRouter = {
      id: routerId,
      name: input.routerName.trim(),
      ipAddress: wgAssignedIp || input.ipAddress || '0.0.0.0',
      apiPort: input.apiPort || 8728,
      username: apiUsername || '',
      encryptedPassword: apiEncryptedPassword || '',
      isOnline: false,
      cpuUsagePct: 0,
      memoryUsagePct: 0,
      routerOsVersion: input.routerosVersion || 'unknown',
      linkedTowerId: input.linkedTowerId,
      lastHealthCheckAt: nowIso(),
      connectionType: 'wireguard' as const,
      provisioningStatus: 'pending' as const,
      managementIp: wgAssignedIp || input.ipAddress || undefined,
      vpnIp: wgAssignedIp,
      notes: input.notes,
    };
    store.MIKROTIK_ROUTERS.push(enrolledRouter);
    try {
      await persistMikrotikRouter(enrolledRouter);
    } catch (persistErr) {
      logger.warn('Enrollment: no se pudo persistir router en Supabase', {
        routerId,
        error: String(persistErr),
      });
    }

    // Snapshot NO sensible del router para regenerar el .rsc en /download tras
    // un restart, sin depender de store.MIKROTIK_ROUTERS (volátil) ni de
    // USE_DB_MIKROTIK. NUNCA incluye secretos (claves, passwords, tokens).
    const routerSnapshot: RouterEnrollmentRouterSnapshot = {
      routerName: input.routerName.trim(),
      managementIp: input.ipAddress || undefined,
      vpnIp: wgAssignedIp || undefined,
      apiPort: input.apiPort ?? 8728,
      linkedTowerId: input.linkedTowerId,
      notes: input.notes,
    };

    // Snapshot WireGuard (secretos cifrados) para regenerar el .rsc de plantillas
    // WG en /download tras un restart, sin depender del WG store en memoria.
    const wireguardSnapshot: RouterEnrollmentWireGuardSnapshot = peerConfig
      ? buildWireguardSnapshot(resolvedServerId, peerConfig)
      : {};

    const snmpSnapshot: RouterEnrollmentSnmpSnapshot = snmpCommunity
      ? buildSnmpSnapshot(snmpCommunity, peerConfig?.allowedCidr)
      : {};

    const repo = getEnrollmentRepository();
    const id = await repo.nextId();
    const rec: RouterEnrollmentRecord = {
      id,
      routerId,
      wgServerId: resolvedServerId,
      wgPeerId,
      enrolledBy: actorId,
      status: 'script_generated',
      routerosVersion: input.routerosVersion,
      templateId: resolvedTemplateId,
      // Persiste los parámetros completados (con secretos en claro) para regenerar en /download.
      templateParameters: effectiveParams,
      routerSnapshot,
      wireguardSnapshot,
      snmpSnapshot,
      scriptHash,
      checkOnlineAttempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await repo.create(rec);

    logger.info('Enrollment iniciado', {
      enrollmentId: id,
      routerId,
      wgPeerId,
      wgServerId: resolvedServerId,
      templateId: resolvedTemplateId,
    });

    const securityMsg =
      'Este script contiene claves privadas WireGuard' +
      (snmpCommunity ? ' y la comunidad SNMP' : '') +
      '. Guárdalo de forma segura, úsalo UNA VEZ y elimínalo del dispositivo tras importarlo.';

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
      snmpCommunity,
    };
  },

  async list(): Promise<RouterEnrollmentView[]> {
    const repo = getEnrollmentRepository();
    return (await repo.list()).map(toView);
  },

  async getById(id: string): Promise<RouterEnrollmentView | null> {
    const repo = getEnrollmentRepository();
    const rec = await repo.findById(id);
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
    const repo = getEnrollmentRepository();
    const rec = await repo.findById(id);
    if (!rec) return null;

    if (rec.status === 'revoked') throw new BadRequestError('El enrollment ha sido revocado.');
    if (rec.status === 'online') throw new BadRequestError('El router ya está online; no se requiere re-descarga.');

    // El router vive en store.MIKROTIK_ROUTERS (volátil). Tras un restart del
    // contenedor el store se vacía pero el enrollment persiste en DB. Para
    // regenerar el .rsc usamos el router del store si está, y si no el snapshot
    // NO sensible persistido en el enrollment (sin depender de USE_DB_MIKROTIK).
    const router = store.MIKROTIK_ROUTERS.find((r) => r.id === rec.routerId);
    const snapshot = rec.routerSnapshot;

    const routerName = router?.name ?? snapshot?.routerName;
    if (!routerName) {
      // Ni router en memoria ni snapshot suficiente para regenerar el script.
      throw new NotFoundError(
        'No se puede regenerar el script: no hay router en memoria ni snapshot ' +
          'persistido para este enrollment. Vuelve a iniciar el enrollment.',
        'ROUTER_SNAPSHOT_MISSING',
      );
    }

    const input: StartEnrollmentInput = {
      routerName,
      ipAddress: router?.ipAddress ?? snapshot?.managementIp,
      apiPort: router?.apiPort ?? snapshot?.apiPort,
      linkedTowerId: router?.linkedTowerId ?? snapshot?.linkedTowerId,
      routerosVersion: rec.routerosVersion,
      // Usa el templateId persistido en el record para regenerar el mismo script.
      templateId: rec.templateId,
      // Fase 4.9.2: regenera con los parámetros persistidos (sin defaults).
      templateParameters: rec.templateParameters,
      notes: router?.notes ?? snapshot?.notes,
    };

    // mode 'download': para plantillas no-WG NO se consulta el WG store; para
    // plantillas WG se usa el snapshot cifrado (o el store como fallback).
    const { script, scriptFilename } = await buildScript(rec.routerId, input, rec.wgServerId, actorId, {
      mode: 'download',
      wgSnapshot: rec.wireguardSnapshot,
      snmpSnapshot: rec.snmpSnapshot,
    });

    const updated = await repo.update(id, {
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
    const repo = getEnrollmentRepository();
    const rec = await repo.findById(id);
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
        try {
          await persistMikrotikRouter(router);
        } catch (persistErr) {
          logger.warn('Enrollment online: no se pudo persistir router', {
            routerId: rec.routerId,
            error: String(persistErr),
          });
        }
      }

      const updated = await repo.update(id, {
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

    const updated = await repo.update(id, {
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
    const repo = getEnrollmentRepository();
    const rec = await repo.findById(id);
    if (!rec) return null;

    if (rec.status === 'revoked') throw new BadRequestError('El enrollment ya está revocado.');

    const wgService = getWireguardService();
    await wgService.revokePeer(rec.wgPeerId);

    // Quitar del Inventario de Routers (memoria + DB) — antes solo marcaba error.
    try {
      await deleteMikrotikRouter(rec.routerId);
    } catch (err) {
      logger.warn('Enrollment revoke: no se pudo borrar router del inventario', {
        routerId: rec.routerId,
        error: String(err),
      });
    }

    const updated = await repo.update(id, {
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

  /**
   * Elimina un enrollment de la lista. Solo permitido si ya está revocado
   * (el peer WG ya no está activo). Para registros activos, usar revoke primero.
   */
  async remove(id: string, actorId: string): Promise<{ deleted: true; id: string } | null> {
    const repo = getEnrollmentRepository();
    const rec = await repo.findById(id);
    if (!rec) return null;

    if (rec.status !== 'revoked') {
      throw new BadRequestError(
        'Solo se pueden eliminar enrollments revocados. Usa Revocar primero.',
      );
    }

    // Por si el revoke anterior rompió a medias: asegurar que no quede huérfano.
    try {
      await deleteMikrotikRouter(rec.routerId);
    } catch (err) {
      logger.warn('Enrollment delete: no se pudo borrar router del inventario', {
        routerId: rec.routerId,
        error: String(err),
      });
    }

    const deleted = await repo.delete(id);
    if (!deleted) return null;

    logger.info('Enrollment eliminado', {
      enrollmentId: id,
      routerId: rec.routerId,
      wgPeerId: rec.wgPeerId,
      deletedBy: actorId,
    });

    return { deleted: true, id };
  },
};

// ====================================================================
// WireGuard Manager — rutas (Fase 4.6.1). RBAC: Super Admin / Administrador.
// Los secretos (private/preshared key) se devuelven UNA sola vez al crear/rotar.
// ====================================================================

import { Router } from 'express';
import { requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getWireguardService } from './service';

const router = Router();
const WG_ROLES = ['super admin', 'administrador'] as const;
// Técnico necesita leer servidores/peers para generar scripts .rsc; no puede crear ni revocar.
const WG_READ_ROLES = [...WG_ROLES, 'tecnico'] as const;

// ── Servidores ───────────────────────────────────────────────────────
router.get('/api/wireguard/servers', requireRoles([...WG_READ_ROLES]), asyncHandler(async (req, res) => {
  res.json(await getWireguardService().listServers(tenantIdFromRequest(req)));
}));

router.get('/api/wireguard/next-ip', requireRoles([...WG_READ_ROLES]), asyncHandler(async (req, res) => {
  const serverId = String(req.query.serverId || '').trim() || undefined;
  res.json(await getWireguardService().previewNextIp(serverId, tenantIdFromRequest(req)));
}));

router.post('/api/wireguard/servers', requireRoles([...WG_ROLES]), asyncHandler(async (req, res) => {
  const { name, endpointHost, endpointPort, listenPort, vpnCidr, serverVpnIp, isDefault } = req.body || {};
  if (!name || !endpointHost) {
    res.status(400).json({ error: 'Missing required fields: name, endpointHost' });
    return;
  }
  const created = await getWireguardService().createServer({
    name: String(name), endpointHost: String(endpointHost),
    endpointPort: endpointPort !== undefined ? Number(endpointPort) : undefined,
    listenPort: listenPort !== undefined ? Number(listenPort) : undefined,
    vpnCidr: vpnCidr ? String(vpnCidr) : undefined,
    serverVpnIp: serverVpnIp ? String(serverVpnIp) : undefined,
    isDefault: isDefault === true || isDefault === 'true',
    tenantId: tenantIdFromRequest(req),
  });
  res.status(201).json({
    ...created,
    securityWarning: 'La private key del servidor se muestra una sola vez. Guárdala de forma segura; NugaCore solo conserva la versión cifrada.',
  });
}));

// ── Peers ─────────────────────────────────────────────────────────────
router.get('/api/wireguard/peers', requireRoles([...WG_READ_ROLES]), asyncHandler(async (req, res) => {
  const serverId = String(req.query.serverId || '').trim() || undefined;
  const status = String(req.query.status || '').trim() || undefined;
  res.json(await getWireguardService().listPeers({
    serverId,
    status,
    tenantId: tenantIdFromRequest(req),
  }));
}));

router.post('/api/wireguard/peers', requireRoles([...WG_ROLES]), asyncHandler(async (req, res) => {
  const { serverId, name, routerId, allowedCidr } = req.body || {};
  if (!serverId || !name) {
    res.status(400).json({ error: 'Missing required fields: serverId, name' });
    return;
  }
  try {
    const created = await getWireguardService().createPeer({
      serverId: String(serverId), name: String(name),
      routerId: routerId ? String(routerId) : undefined,
      allowedCidr: allowedCidr ? String(allowedCidr) : undefined,
      tenantId: tenantIdFromRequest(req),
    }, req.authContext?.userId);
    res.status(201).json({
      ...created,
      securityWarning: 'La private key y la preshared key se muestran una sola vez. Guárdalas ahora; NugaCore solo conserva las versiones cifradas.',
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not create peer' });
  }
}));

router.post('/api/wireguard/peers/:id/rotate', requireRoles([...WG_ROLES]), asyncHandler(async (req, res) => {
  const result = await getWireguardService().rotatePeer(req.params.id, req.authContext?.userId, req.body?.reason ? String(req.body.reason) : undefined);
  if (!result) {
    res.status(404).json({ error: 'Active peer not found' });
    return;
  }
  res.status(201).json({
    ...result,
    securityWarning: 'Nuevas claves: se muestran una sola vez. Reaplica el script en el router.',
  });
}));

router.delete('/api/wireguard/peers/:id', requireRoles([...WG_ROLES]), asyncHandler(async (req, res) => {
  const ok = await getWireguardService().revokePeer(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Peer not found' });
    return;
  }
  res.json({ revoked: true, peerId: req.params.id });
}));

// ── Rotaciones (auditoría) ────────────────────────────────────────────
router.get('/api/wireguard/peers/:id/rotations', requireRoles([...WG_ROLES]), asyncHandler(async (req, res) => {
  res.json(await getWireguardService().listRotations(req.params.id));
}));

export default router;

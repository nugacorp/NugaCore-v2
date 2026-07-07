import { Router } from 'express';
import { OnuFTTH, Tower } from '../../../src/types';
import { store } from '../../../backend/state/store';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getNetworkService } from './service';
import { getFtthService } from './ftth-service';
import { getCustomersService } from '../customers/service';

const router = Router();

const parseTowerStatus = (value: unknown): Tower['status'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'online') return 'online';
  if (normalized === 'warning') return 'warning';
  if (normalized === 'offline') return 'offline';
  return null;
};

const applyTowerState = (tower: Tower, nextState: Tower['status']) => {
  tower.status = nextState;
  if (nextState === 'offline') {
    tower.cpu = 0;
    tower.ram = 0;
    tower.pingMs = -1;
  } else if (nextState === 'warning') {
    tower.cpu = Math.max(tower.cpu, 70);
    tower.ram = Math.max(tower.ram, 75);
    tower.pingMs = Math.max(tower.pingMs, 25);
  } else {
    tower.cpu = tower.cpu <= 0 ? 25 : Math.min(tower.cpu, 60);
    tower.ram = tower.ram <= 0 ? 40 : Math.min(tower.ram, 70);
    tower.pingMs = tower.pingMs <= 0 ? 12 : Math.min(tower.pingMs, 35);
  }
};

const recalculateTowerStatusFromSectors = (towerId: string): void => {
  const tower = store.TOWERS.find((item) => item.id === towerId);
  if (!tower) return;
  const sectors = store.NETWORK_SECTORS.filter((item) => item.towerId === towerId);
  if (sectors.length === 0) return;

  const hasOffline = sectors.some((item) => item.status === 'offline');
  const hasWarning = sectors.some((item) => item.status === 'warning');
  if (hasOffline) {
    applyTowerState(tower, 'warning');
    return;
  }
  if (hasWarning) {
    applyTowerState(tower, 'warning');
    return;
  }
  applyTowerState(tower, 'online');
};

router.get('/api/network-towers', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const status = parseTowerStatus(req.query.status);
  const q = String(req.query.q || '').trim();
  const rows = await getNetworkService().listTowers({
    status: status ?? undefined,
    q: q || undefined,
  });
  res.json(rows);
}));

router.get('/api/network-towers/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tower = await getNetworkService().getTower(req.params.id);
  if (!tower) {
    return res.status(404).json({ error: 'Tower not found' });
  }
  res.json(tower);
}));

router.post('/api/network-towers', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const { name, lat, lng, height, coverageRadiusKm, ip, equipment } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing required field: name' });
  }

  const duplicated = store.TOWERS.some((tower) => tower.name.toLowerCase() === String(name).toLowerCase());
  if (duplicated) {
    return res.status(409).json({ error: 'Tower name already exists' });
  }

  const newTower: Tower = {
    id: 't-' + (store.TOWERS.length + 1) + '-' + Math.floor(Math.random() * 90 + 10),
    name,
    status: 'online',
    lat: Number(lat) || 19.3908,
    lng: Number(lng) || -99.1895,
    height: Number(height) || 30,
    coverageRadiusKm: Number(coverageRadiusKm) || 5,
    ip: ip || '10.0.1.' + (store.TOWERS.length + 10),
    cpu: 10,
    ram: 25,
    tempCelsius: 34,
    pingMs: 12,
    uptime: '0d 0h 10m',
    ports: [
      { port: 'eth1 (WAN Uplink)', status: 'up', speed: '1 Gbps' },
      { port: 'eth2 (SFP AP Backbone)', status: 'up', speed: '10 Gbps' },
      { port: 'eth3 (Sector Norte)', status: 'down', speed: '100 Mbps' },
      { port: 'eth4 (Sector Sur)', status: 'down', speed: '100 Mbps' },
    ],
    equipment: equipment && equipment.length > 0 ? equipment : [
      { name: 'RB5009UG+S+OUT', type: 'Router principal', brand: 'MikroTik' },
      { name: 'Rocket5 AC Gen2', type: 'AP Sectorial', brand: 'Ubiquiti' },
    ],
  };
  store.TOWERS.push(newTower);
  store.NETWORK_SECTORS.push(
    {
      id: store.getUniqueSectorId(),
      towerId: newTower.id,
      name: 'Sector Norte',
      azimuth: 0,
      frequency: '5800 MHz',
      status: 'online',
      clientsCount: 0,
    },
    {
      id: store.getUniqueSectorId(),
      towerId: newTower.id,
      name: 'Sector Sur',
      azimuth: 180,
      frequency: '5800 MHz',
      status: 'online',
      clientsCount: 0,
    },
  );
  store.createAlert('tower', 'info', name, `Nueva subestacion de telecomunicaciones ${name} conectada correctamente.`);
  res.status(201).json(newTower);
});

router.put('/api/network-towers/:id', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const index = store.TOWERS.findIndex((tower) => tower.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Tower not found' });
  }

  const { name, lat, lng, height, coverageRadiusKm, ip } = req.body;
  const current = store.TOWERS[index];
  store.TOWERS[index] = {
    ...current,
    ...(name !== undefined ? { name: String(name) } : {}),
    ...(lat !== undefined ? { lat: Number(lat) } : {}),
    ...(lng !== undefined ? { lng: Number(lng) } : {}),
    ...(height !== undefined ? { height: Number(height) } : {}),
    ...(coverageRadiusKm !== undefined ? { coverageRadiusKm: Number(coverageRadiusKm) } : {}),
    ...(ip !== undefined ? { ip: String(ip) } : {}),
  };

  res.json(store.TOWERS[index]);
});

router.delete('/api/network-towers/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const tower = store.TOWERS.find((item) => item.id === req.params.id);
  if (!tower) {
    return res.status(404).json({ error: 'Tower not found' });
  }

  store.TOWERS = store.TOWERS.filter((item) => item.id !== req.params.id);
  store.NETWORK_SECTORS = store.NETWORK_SECTORS.filter((item) => item.towerId !== req.params.id);
  res.status(204).send();
});

router.post('/api/network-towers/:id/state', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const tower = store.TOWERS.find((item) => item.id === req.params.id);
  if (!tower) {
    return res.status(404).json({ error: 'Tower not found' });
  }

  const nextStatus = parseTowerStatus(req.body.status);
  if (!nextStatus) {
    return res.status(400).json({ error: 'Invalid status. Allowed: online, warning, offline' });
  }

  applyTowerState(tower, nextStatus);
  store.createAlert(
    'tower',
    nextStatus === 'offline' ? 'critical' : nextStatus === 'warning' ? 'warning' : 'info',
    tower.name,
    `Estado de torre actualizado a ${nextStatus}.`,
  );
  res.json(tower);
});

router.post('/api/network-towers/:id/toggle-state', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const { id } = req.params;
  const tower = store.TOWERS.find((t) => t.id === id);
  if (tower) {
    if (tower.status === 'online' || tower.status === 'warning') {
      applyTowerState(tower, 'offline');
      store.createAlert('tower', 'critical', tower.name, `ATENCION: La torre ${tower.name} ha dejado de reportar pings (Enlace caido).`);

      store.MIKROTIK_LOGS.push({
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `system,error OSPF Link failure to ${tower.ip} - peer unreachable`,
      });
    } else {
      applyTowerState(tower, 'online');
      store.createAlert('tower', 'info', tower.name, `Conexion reestablecida con exito de la torre ${tower.name}.`);
    }
    res.json(tower);
  } else {
    res.status(404).json({ error: 'Tower node and telemetry core not found.' });
  }
});

router.get('/api/network-towers/:id/sectors', requireRoles(READ_ROLES), (req, res) => {
  const tower = store.TOWERS.find((item) => item.id === req.params.id);
  if (!tower) {
    return res.status(404).json({ error: 'Tower not found' });
  }
  const sectors = store.NETWORK_SECTORS.filter((item) => item.towerId === req.params.id);
  res.json(sectors);
});

router.post('/api/network-towers/:id/sectors', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const tower = store.TOWERS.find((item) => item.id === req.params.id);
  if (!tower) {
    return res.status(404).json({ error: 'Tower not found' });
  }

  const { name, azimuth, frequency, status, clientsCount } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing required field: name' });
  }

  const parsedStatus = parseTowerStatus(status) || 'online';
  const sector = {
    id: store.getUniqueSectorId(),
    towerId: tower.id,
    name: String(name),
    azimuth: Number(azimuth) || 0,
    frequency: String(frequency || '5800 MHz'),
    status: parsedStatus,
    clientsCount: Number(clientsCount) || 0,
  };
  store.NETWORK_SECTORS.push(sector);
  recalculateTowerStatusFromSectors(tower.id);
  res.status(201).json(sector);
});

router.put('/api/network-sectors/:id', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const index = store.NETWORK_SECTORS.findIndex((item) => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Sector not found' });
  }

  const current = store.NETWORK_SECTORS[index];
  const nextStatus = req.body.status !== undefined ? parseTowerStatus(req.body.status) : current.status;
  if (req.body.status !== undefined && !nextStatus) {
    return res.status(400).json({ error: 'Invalid status. Allowed: online, warning, offline' });
  }

  store.NETWORK_SECTORS[index] = {
    ...current,
    ...(req.body.name !== undefined ? { name: String(req.body.name) } : {}),
    ...(req.body.azimuth !== undefined ? { azimuth: Number(req.body.azimuth) } : {}),
    ...(req.body.frequency !== undefined ? { frequency: String(req.body.frequency) } : {}),
    ...(req.body.clientsCount !== undefined ? { clientsCount: Number(req.body.clientsCount) } : {}),
    status: nextStatus || current.status,
  };

  recalculateTowerStatusFromSectors(current.towerId);
  res.json(store.NETWORK_SECTORS[index]);
});

router.delete('/api/network-sectors/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const sector = store.NETWORK_SECTORS.find((item) => item.id === req.params.id);
  if (!sector) {
    return res.status(404).json({ error: 'Sector not found' });
  }

  store.NETWORK_SECTORS = store.NETWORK_SECTORS.filter((item) => item.id !== req.params.id);
  recalculateTowerStatusFromSectors(sector.towerId);
  res.status(204).send();
});

router.get('/api/olt', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getFtthService().listOlts());
}));

router.get('/api/onu', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getFtthService().listOnus());
}));

router.get('/api/naps', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getFtthService().listNaps());
}));

router.post('/api/onu/provision', requireRoles(['super admin', 'administrador', 'tecnico']), asyncHandler(async (req, res) => {
  const { clientId, oltId, port, mac, brand, model, napId, napPort } = req.body;
  const client = clientId ? await getCustomersService().getById(String(clientId)) : null;
  if (!client) {
    return res.status(400).json({ error: 'Invalid client' });
  }

  const newOnuId = store.getUniqueOnuId();
  const newOnu: OnuFTTH = {
    id: newOnuId,
    clientId,
    clientName: client.name,
    oltId: oltId || 'olt-1',
    port: Number(port) || 1,
    mac: mac || 'HWTC:DE:AD:BE:EF',
    signalDb: -21.8,
    status: 'online',
    brand: brand || 'Huawei',
    model: model || 'ONU Dual-Band',
    napId,
    napPort: napPort ? Number(napPort) : undefined,
  };

  store.ONUS.push(newOnu);

  if (napId && napPort) {
    const nap = store.NAP_BOXES.find((n) => n.id === napId);
    if (nap) {
      const pNum = Number(napPort);
      const targetPort = nap.ports.find((p) => p.num === pNum);
      if (targetPort) {
        targetPort.status = 'occupied';
        targetPort.client = `${client.name} (${newOnuId})`;
      }
      nap.fibersFree = nap.ports.filter((p) => p.status === 'free').length;
    }
  }

  res.json(newOnu);
}));

export default router;

import { Router } from 'express';
import { store } from '../../state/store';

const router = Router();

router.get('/api/gis/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'mock-gis-v1' });
});

router.get('/api/gis/layers', (_req, res) => {
  res.json([
    { id: 'towers', label: 'Torres WISP', enabled: true },
    { id: 'clients', label: 'Clientes', enabled: true },
    { id: 'naps', label: 'NAPs FTTH', enabled: true },
    { id: 'onus', label: 'ONUs', enabled: true },
    { id: 'olts', label: 'OLTs', enabled: true },
  ]);
});

router.get('/api/gis/map-data', (req, res) => {
  const status = String(req.query.status || '').trim().toLowerCase();
  const planId = String(req.query.planId || '').trim();
  const towerId = String(req.query.towerId || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();

  const towers = store.TOWERS.filter((tower) => {
    const matchesStatus = !status || tower.status === status;
    const matchesTower = !towerId || tower.id === towerId;
    const matchesQ = !q
      || tower.name.toLowerCase().includes(q)
      || tower.ip.toLowerCase().includes(q);

    return matchesStatus && matchesTower && matchesQ;
  });

  const clients = store.CLIENTS.filter((client) => {
    const matchesStatus = !status || client.status === status;
    const matchesPlan = !planId || client.planId === planId;
    const matchesQ = !q
      || client.name.toLowerCase().includes(q)
      || client.address.toLowerCase().includes(q)
      || client.city.toLowerCase().includes(q);

    if (!matchesStatus || !matchesPlan || !matchesQ) {
      return false;
    }

    if (!towerId) {
      return true;
    }

    return store.MIKROTIK_ROUTERS.some((router) => router.linkedTowerId === towerId && router.isOnline);
  });

  const plans = store.PLANS.map((plan) => ({
    id: plan.id,
    name: plan.name,
    clientsCount: clients.filter((client) => client.planId === plan.id).length,
  }));

  const towerCoverage = towers.map((tower) => ({
    id: tower.id,
    name: tower.name,
    coverageRadiusKm: tower.coverageRadiusKm,
    linkedClients: clients.length,
  }));

  res.json({
    filtersApplied: { status: status || null, planId: planId || null, towerId: towerId || null, q: q || null },
    towers,
    clients,
    naps: store.NAP_BOXES,
    onus: store.ONUS,
    olts: store.OLTS,
    plans,
    towerCoverage,
  });
});

router.get('/api/gis/customers', (req, res) => {
  const status = String(req.query.status || '').trim().toLowerCase();
  const planId = String(req.query.planId || '').trim();

  const rows = store.CLIENTS.filter((client) => {
    const matchesStatus = !status || client.status === status;
    const matchesPlan = !planId || client.planId === planId;
    return matchesStatus && matchesPlan;
  });

  res.json(rows);
});

router.get('/api/gis/towers', (req, res) => {
  const status = String(req.query.status || '').trim().toLowerCase();
  const rows = store.TOWERS.filter((tower) => !status || tower.status === status);
  res.json(rows);
});

export default router;

import { getCustomersService, parseClientStatus } from '../customers/service';
import { getPlansService } from '../plans/service';
import { getNetworkService } from '../network/service';
import { getFtthService } from '../network/ftth-service';

export interface GisMapFilters {
  status?: string;
  planId?: string;
  towerId?: string;
  q?: string;
}

export async function buildGisMapData(filters: GisMapFilters = {}) {
  const status = String(filters.status || '').trim().toLowerCase();
  const planId = String(filters.planId || '').trim();
  const towerId = String(filters.towerId || '').trim();
  const q = String(filters.q || '').trim().toLowerCase();

  const [towers, clients, plans, naps, onus, olts] = await Promise.all([
    getNetworkService().listTowers({ status: status || undefined, q: q || undefined }),
    getCustomersService().list({
      status: parseClientStatus(status) ?? undefined,
      planId: planId || undefined,
      q: q || undefined,
    }),
    getPlansService().list({}),
    getFtthService().listNaps(),
    getFtthService().listOnus(),
    getFtthService().listOlts(),
  ]);

  const filteredTowers = towers.filter((tower) => !towerId || tower.id === towerId);

  const filteredClients = clients.filter((client) => {
    if (towerId) {
      return client.routerId != null;
    }
    return true;
  });

  const planStats = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    clientsCount: filteredClients.filter((c) => c.planId === plan.id).length,
  }));

  const towerCoverage = filteredTowers.map((tower) => ({
    id: tower.id,
    name: tower.name,
    coverageRadiusKm: tower.coverageRadiusKm,
    linkedClients: filteredClients.length,
  }));

  return {
    filtersApplied: {
      status: status || null,
      planId: planId || null,
      towerId: towerId || null,
      q: q || null,
    },
    towers: filteredTowers,
    clients: filteredClients,
    naps,
    onus,
    olts,
    plans: planStats,
    towerCoverage,
  };
}

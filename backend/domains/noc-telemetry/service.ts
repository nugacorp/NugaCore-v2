// ====================================================================
// Service NOC Real Telemetry (Fase 4.11.3)
//
// Deriva salud agregada y telemetría por torre desde datos ya disponibles.
// READ-ONLY: no ejecuta RouterOS, no escribe, no notifica, no encola.
// Reutiliza el repositorio del dominio `noc` para listar routers (mismo store).
// Las alertas se sirven por el endpoint existente `/api/noc/alerts` (4.11.2);
// este dominio NO redefine esa ruta para evitar colisión de routing.
// ====================================================================

import { nocReadOnlyRepository } from '../noc/repository';
import { getNetworkService } from '../network/service';
import { aggregateTowers, summarizeHealth } from './mappers';
import type { NocHealthSummary, NocTowerTelemetry } from './types';

export const nocTelemetryService = {
  getHealth(): NocHealthSummary {
    return summarizeHealth(nocReadOnlyRepository.listRouters());
  },

  async listTowers(): Promise<NocTowerTelemetry[]> {
    const towers = await getNetworkService().listTowers({});
    return aggregateTowers(towers, nocReadOnlyRepository.listRouters());
  },
};

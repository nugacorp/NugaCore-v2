import { Router } from 'express';
import { AppRole, requireRoles } from '../../common/rbac';
import { nocTelemetryService } from './service';

// ====================================================================
// NOC Real Telemetry (Fase 4.11.3)
//
// Endpoints SOLO LECTURA de observabilidad. Mismo RBAC que 4.11.2:
// Cobranza queda excluido. No existen endpoints de escritura en este dominio.
// `/api/noc/alerts` ya lo provee el dominio `noc` (4.11.2); aquí solo se
// agregan `/api/noc/health` y `/api/noc/towers`.
// ====================================================================

const NOC_READ_ROLES: AppRole[] = ['super admin', 'administrador', 'tecnico', 'soporte', 'solo lectura'];

const router = Router();

router.get('/api/noc/health', requireRoles(NOC_READ_ROLES), (_req, res) => {
  res.json(nocTelemetryService.getHealth());
});

router.get('/api/noc/towers', requireRoles(NOC_READ_ROLES), (_req, res) => {
  res.json(nocTelemetryService.listTowers());
});

export default router;

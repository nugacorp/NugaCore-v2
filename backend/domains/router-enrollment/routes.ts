// ====================================================================
// Rutas REST del dominio Router Enrollment (Fase 4.7).
//
// POST  /api/router-enrollment/start        → iniciar enrollment
// GET   /api/router-enrollment              → listar
// GET   /api/router-enrollment/:id          → detalle
// GET   /api/router-enrollment/:id/download → descargar script .rsc
// POST  /api/router-enrollment/:id/check-online → confirmar online
// GET   /api/router-enrollment/:id/repair-api → .rsc mínimo (solo usuario API)
// POST  /api/router-enrollment/:id/revoke   → revocar
// DELETE /api/router-enrollment/:id         → eliminar (solo revocados)
//
// RBAC:
//   start / list / get / download / check-online : super admin, administrador, tecnico
//   revoke / delete                               : super admin, administrador
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { enrollmentService } from './service';

const router = Router();

const CAN_ENROLL = ['super admin', 'administrador', 'tecnico'] as const;
const CAN_REVOKE = ['super admin', 'administrador'] as const;

// ── POST /start ───────────────────────────────────────────────────────

router.post(
  '/api/router-enrollment/start',
  requireRoles([...CAN_ENROLL]),
  asyncHandler(async (req, res) => {
    const actorId = req.authContext?.userId ?? 'unknown';
    const result = await enrollmentService.start(req.body, actorId, tenantIdFromRequest(req));
    res.status(201).json(result);
  }),
);

// ── GET / (listar) ────────────────────────────────────────────────────

router.get(
  '/api/router-enrollment',
  requireRoles([...CAN_ENROLL]),
  asyncHandler(async (req, res) => {
    res.json(await enrollmentService.list(tenantIdFromRequest(req)));
  }),
);

// ── GET /:id ──────────────────────────────────────────────────────────

router.get(
  '/api/router-enrollment/:id',
  requireRoles([...CAN_ENROLL]),
  asyncHandler(async (req, res) => {
    const enrollment = await enrollmentService.getById(req.params.id, tenantIdFromRequest(req));
    if (!enrollment) return res.status(404).json({ error: 'Enrollment no encontrado.' });
    res.json(enrollment);
  }),
);

// ── GET /:id/download ─────────────────────────────────────────────────

router.get(
  '/api/router-enrollment/:id/download',
  requireRoles([...CAN_ENROLL]),
  asyncHandler(async (req, res) => {
    const actorId = req.authContext?.userId ?? 'unknown';
    const result = await enrollmentService.download(
      req.params.id,
      actorId,
      tenantIdFromRequest(req),
    );
    if (!result) return res.status(404).json({ error: 'Enrollment no encontrado.' });

    res
      .status(200)
      .setHeader('Content-Type', 'text/plain; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
      .setHeader('Cache-Control', 'no-store')
      .send(result.script);
  }),
);

// ── POST /:id/check-online ────────────────────────────────────────────

router.post(
  '/api/router-enrollment/:id/check-online',
  requireRoles([...CAN_ENROLL]),
  asyncHandler(async (req, res) => {
    const result = await enrollmentService.checkOnline(
      req.params.id,
      tenantIdFromRequest(req),
    );
    res.json(result);
  }),
);

// ── GET /:id/repair-api ───────────────────────────────────────────────

router.get(
  '/api/router-enrollment/:id/repair-api',
  requireRoles([...CAN_ENROLL]),
  asyncHandler(async (req, res) => {
    const actorId = req.authContext?.userId ?? 'unknown';
    const result = await enrollmentService.downloadApiRepair(
      req.params.id,
      actorId,
      tenantIdFromRequest(req),
    );
    if (!result) return res.status(404).json({ error: 'Enrollment no encontrado.' });

    res
      .status(200)
      .setHeader('Content-Type', 'text/plain; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
      .setHeader('Cache-Control', 'no-store')
      .send(result.script);
  }),
);

// ── POST /:id/revoke ──────────────────────────────────────────────────

router.post(
  '/api/router-enrollment/:id/revoke',
  requireRoles([...CAN_REVOKE]),
  asyncHandler(async (req, res) => {
    const actorId = req.authContext?.userId ?? 'unknown';
    const enrollment = await enrollmentService.revoke(
      req.params.id,
      actorId,
      tenantIdFromRequest(req),
    );
    if (!enrollment) return res.status(404).json({ error: 'Enrollment no encontrado.' });
    res.json(enrollment);
  }),
);

// ── DELETE /:id (solo revocados) ──────────────────────────────────────

router.delete(
  '/api/router-enrollment/:id',
  requireRoles([...CAN_REVOKE]),
  asyncHandler(async (req, res) => {
    const actorId = req.authContext?.userId ?? 'unknown';
    const result = await enrollmentService.remove(
      req.params.id,
      actorId,
      tenantIdFromRequest(req),
    );
    if (!result) return res.status(404).json({ error: 'Enrollment no encontrado.' });
    res.json(result);
  }),
);

export default router;

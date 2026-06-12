// ====================================================================
// Rutas Express — Biblioteca de Plantillas RouterOS (Fase 4.6.3).
//
// Prefijo: /api/routeros-templates
//
// RBAC:
//   Ver catálogo / generar  : super admin, administrador, tecnico
//   Historial               : super admin, administrador
// ====================================================================

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { requireRoles } from '../../common/rbac';
import { TEMPLATE_LIBRARY } from './templates';
import { generateFromTemplate } from './generator';
import { validateTemplateParams, sanitizeForPreview } from './validators';
import { TemplateGenerationRecord, TemplateLibraryParams } from './types';

const router = Router();

const TPL_VIEW_ROLES  = ['super admin', 'administrador', 'tecnico'] as const;
const TPL_ADMIN_ROLES = ['super admin', 'administrador'] as const;

// Historial en memoria (solo metadatos; nunca el script completo ni passwords).
const history: TemplateGenerationRecord[] = [];

// Cache temporal de scripts para descarga inmediata (TTL 1 hora).
const scriptCache = new Map<string, { script: string; filename: string; expiresAt: number }>();

const pruneCache = (): void => {
  const now = Date.now();
  for (const [k, v] of scriptCache.entries()) {
    if (v.expiresAt < now) scriptCache.delete(k);
  }
};

// ── GET /api/routeros-templates/catalog ──────────────────────────
router.get(
  '/api/routeros-templates/catalog',
  requireRoles([...TPL_VIEW_ROLES]),
  (_req: Request, res: Response) => {
    res.json(TEMPLATE_LIBRARY);
  },
);

// ── POST /api/routeros-templates/generate ────────────────────────
router.post(
  '/api/routeros-templates/generate',
  requireRoles([...TPL_VIEW_ROLES]),
  (req: Request, res: Response) => {
    const params = req.body as Partial<TemplateLibraryParams>;
    const validation = validateTemplateParams(params);

    if (!validation.valid) {
      res.status(400).json({ error: 'Parámetros inválidos', details: validation.errors });
      return;
    }

    let result;
    try {
      result = generateFromTemplate(params as TemplateLibraryParams);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Error al generar el script', detail: msg });
      return;
    }

    // Cachear script para descarga (TTL 1 hora).
    pruneCache();
    scriptCache.set(result.scriptHash, {
      script: result.script,
      filename: result.filename,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    // Persistir solo metadatos.
    const actorId = req.authContext?.userId;
    const record: TemplateGenerationRecord = {
      id: randomBytes(8).toString('hex'),
      templateId: result.templateId,
      routerName: (params as TemplateLibraryParams).routerName,
      filename: result.filename,
      scriptHash: result.scriptHash,
      generatorVersion: result.generatorVersion,
      warnings: result.warnings,
      generatedAt: result.generatedAt,
      generatedBy: actorId,
    };
    history.unshift(record);
    if (history.length > 200) history.splice(200);

    res.json({
      script: result.script,
      scriptPreview: sanitizeForPreview(result.script),
      scriptHash: result.scriptHash,
      filename: result.filename,
      templateId: result.templateId,
      generatorVersion: result.generatorVersion,
      warnings: result.warnings,
      generatedAt: result.generatedAt,
      apiUsername: result.apiUsername,
      securityNotice:
        'Descarga este script ahora. Contiene credenciales que no se vuelven a mostrar. ' +
        'NugaCore solo conserva el hash.',
    });
  },
);

// ── GET /api/routeros-templates/download/:hash ───────────────────
router.get(
  '/api/routeros-templates/download/:hash',
  requireRoles([...TPL_VIEW_ROLES]),
  (req: Request, res: Response) => {
    pruneCache();
    const cached = scriptCache.get(req.params.hash);

    if (!cached) {
      res.status(404).json({
        error:
          'Script no encontrado o expirado. El script está disponible durante 1 hora tras su generación. ' +
          'Vuelve a generar el script si es necesario.',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${cached.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(cached.script);
  },
);

// ── GET /api/routeros-templates/history ──────────────────────────
router.get(
  '/api/routeros-templates/history',
  requireRoles([...TPL_ADMIN_ROLES]),
  (_req: Request, res: Response) => {
    res.json(
      history.map((r) => ({
        id: r.id,
        templateId: r.templateId,
        routerName: r.routerName,
        filename: r.filename,
        scriptHash: r.scriptHash,
        generatedAt: r.generatedAt,
        generatedBy: r.generatedBy,
        warnings: r.warnings,
        generatorVersion: r.generatorVersion,
      })),
    );
  },
);

// ── GET /api/routeros-templates/history/:id ──────────────────────
router.get(
  '/api/routeros-templates/history/:id',
  requireRoles([...TPL_ADMIN_ROLES]),
  (req: Request, res: Response) => {
    const record = history.find((r) => r.id === req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    }
    res.json(record);
  },
);

export default router;

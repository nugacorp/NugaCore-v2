import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { requireRoles } from '../../common/rbac';
import { TEMPLATES } from './templates';
import { generateResource } from './generator';
import { sanitizeScriptForPreview } from './safe-rsc';
import { validateParams } from './validators';
import { ResourceGenerationRecord, ResourceGeneratorParams } from './types';

const router = Router();

// RBAC del generador de recursos RouterOS (Fase 4.6.2)
const RES_VIEW_ROLES = ['super admin', 'administrador', 'tecnico', 'solo lectura'] as const;
const RES_GENERATE_ROLES = ['super admin', 'administrador', 'tecnico'] as const;
const RES_ADMIN_ROLES = ['super admin', 'administrador'] as const;

// Store en memoria: metadatos de generaciones (nunca el script completo).
const history: ResourceGenerationRecord[] = [];

// Cache temporal de scripts generados para descarga inmediata (TTL: 1 hora).
// Map<scriptHash, { script, filename, expiresAt }>
const scriptCache = new Map<string, { script: string; filename: string; expiresAt: number }>();

const pruneExpiredCache = () => {
  const now = Date.now();
  for (const [hash, entry] of scriptCache.entries()) {
    if (entry.expiresAt < now) scriptCache.delete(hash);
  }
};

// ── GET /api/routeros-resources/templates ────────────────────────────
router.get(
  '/api/routeros-resources/templates',
  requireRoles([...RES_VIEW_ROLES]),
  (_req: Request, res: Response) => {
    res.json(TEMPLATES);
  },
);

// ── POST /api/routeros-resources/generate ────────────────────────────
router.post(
  '/api/routeros-resources/generate',
  requireRoles([...RES_GENERATE_ROLES]),
  (req: Request, res: Response) => {
    const params = req.body as Partial<ResourceGeneratorParams>;

    const validation = validateParams(params);
    if (!validation.valid) {
      res.status(400).json({ error: 'Parámetros inválidos', details: validation.errors });
      return;
    }

    let result;
    try {
      result = generateResource(params as ResourceGeneratorParams);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Error al generar el script', detail: msg });
      return;
    }

    // Cachear script para descarga (TTL 1 hora).
    pruneExpiredCache();
    scriptCache.set(result.scriptHash, {
      script: result.script,
      filename: result.filename,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    // Persistir solo los metadatos — nunca el script ni los passwords.
    const actorId = req.authContext?.userId;
    const record: ResourceGenerationRecord = {
      id: randomBytes(8).toString('hex'),
      templateId: result.templateId,
      routerName: (params as ResourceGeneratorParams).routerName,
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
      scriptPreview: sanitizeScriptForPreview(result.script),
      scriptHash: result.scriptHash,
      filename: result.filename,
      templateId: result.templateId,
      generatorVersion: result.generatorVersion,
      warnings: result.warnings,
      generatedAt: result.generatedAt,
      apiUsername: result.apiUsername,
      securityNotice:
        'Descarga este script ahora. Contiene credenciales y no se volverá a mostrar. ' +
        'NugaCore solo conserva el hash.',
    });
  },
);

// ── GET /api/routeros-resources/download/:hash ───────────────────────
router.get(
  '/api/routeros-resources/download/:hash',
  requireRoles([...RES_GENERATE_ROLES]),
  (req: Request, res: Response) => {
    pruneExpiredCache();
    const { hash } = req.params;
    const cached = scriptCache.get(hash);

    if (!cached) {
      res.status(404).json({
        error:
          'Script no encontrado o expirado. El script solo está disponible durante 1 hora tras su generación. ' +
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

// ── GET /api/routeros-resources/history ──────────────────────────────
router.get(
  '/api/routeros-resources/history',
  requireRoles([...RES_ADMIN_ROLES]),
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
      })),
    );
  },
);

// ── GET /api/routeros-resources/history/:id ──────────────────────────
router.get(
  '/api/routeros-resources/history/:id',
  requireRoles([...RES_ADMIN_ROLES]),
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

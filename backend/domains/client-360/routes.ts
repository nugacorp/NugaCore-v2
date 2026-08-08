import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getClient360Service } from './service';

const router = Router();
const WRITE = ['super admin', 'administrador', 'soporte', 'cobranza', 'tecnico'] as const;
const svc = () => getClient360Service();

router.get('/api/clients/:clientId/expediente', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().getExpediente(req.params.clientId, tenantId));
}));

router.get('/api/clients/:clientId/tags', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().listTags(req.params.clientId, tenantId));
}));

router.post('/api/clients/:clientId/tags', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  const created = await svc().addTag(
    req.params.clientId,
    tenantId,
    String(req.body?.label || ''),
    req.body?.color ? String(req.body.color) : undefined,
  );
  res.status(201).json(created);
}));

router.delete('/api/clients/:clientId/tags/:tagId', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().removeTag(req.params.clientId, tenantId, req.params.tagId));
}));

router.get('/api/clients/:clientId/contacts', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().listContacts(req.params.clientId, tenantId));
}));

router.post('/api/clients/:clientId/contacts', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.status(201).json(await svc().addContact(req.params.clientId, tenantId, req.body || {}));
}));

router.get('/api/clients/:clientId/documents', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().listDocuments(req.params.clientId, tenantId));
}));

// Paso 1 de la subida: el backend valida y firma; el navegador sube directo
// al bucket con la URL devuelta. Los bytes no pasan por Express.
router.post('/api/clients/:clientId/documents/upload-url', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.status(201).json(await svc().prepareDocumentUpload(req.params.clientId, tenantId, req.body || {}));
}));

// Compensación: la subida salió bien pero el registro falló, así que hay un
// objeto sin fila. Recibe {documentId, fileName} y recalcula la ruta — nunca la
// acepta. Va antes del POST de metadatos sólo por legibilidad: son paths
// distintos y no compiten.
router.post('/api/clients/:clientId/documents/orphan-cleanup', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().cleanupOrphanDocumentObject(req.params.clientId, tenantId, req.body || {}));
}));

// Paso 2: registrar los metadatos. El `storagePath` NO se acepta: se deriva del
// documentId que devolvió `upload-url`.
router.post('/api/clients/:clientId/documents', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.status(201).json(await svc().addDocument(req.params.clientId, tenantId, req.body || {}, req.authContext?.userId));
}));

// Baja de un documento: borra la fila y, si nada más lo referencia, el objeto.
router.delete('/api/clients/:clientId/documents/:documentId', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().deleteDocument(req.params.clientId, tenantId, req.params.documentId));
}));

// Descarga: URL firmada de vida corta. El bucket es privado.
router.get('/api/clients/:clientId/documents/:documentId/download-url', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().getDocumentDownloadUrl(req.params.clientId, tenantId, req.params.documentId));
}));

router.get('/api/clients/:clientId/activity', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  const limit = Math.min(100, Number(req.query.limit) || 50);
  res.json(await svc().listActivity(req.params.clientId, tenantId, limit));
}));

export default router;

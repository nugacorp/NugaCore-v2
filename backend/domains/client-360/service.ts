import { isDomainOnDb } from '../../config/feature-flags';
import { BadRequestError, ConflictError, NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  buildDocumentPath,
  createDocumentDownloadUrl,
  createDocumentUploadUrl,
  isStorageConfigured,
  pathBelongsToTenant,
  removeDocumentObject,
} from '../../services/supabase-storage';
import { getCustomersService } from '../customers/service';
import {
  client360Memory,
  uid,
  stamp,
  isEmittedDocumentId,
  matchesTenant,
  type ActivityLogEntry,
  type AlternateContact,
  type ClientDocument,
  type ClientTag,
} from './memory-store';

/**
 * Los mismos valores que el CHECK de `client_documents.doc_type`
 * (`20260715000000_client_documents_reconciliation.sql:38`). Validarlos aquí
 * convierte un 500 del CHECK en un 400 con diagnóstico.
 */
const DOCUMENT_TYPES = ['ine', 'contract', 'receipt', 'installation_photo', 'other'] as const;

/** Los que la API acepta: `contract` está reservado al flujo de firma. */
const ASSIGNABLE_DOCUMENT_TYPES = DOCUMENT_TYPES.filter((t) => t !== 'contract');

export class Client360Service {
  private useDb = isDomainOnDb('customers') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase admin client not configured');
    return supabaseAdmin;
  }

  /** Asserts the client exists and belongs to the tenant (P0 IDOR guard). */
  async assertClientOwned(clientId: string, tenantId: string): Promise<void> {
    const client = await getCustomersService().getById(clientId, tenantId);
    if (!client) throw new NotFoundError('Customer not found', 'NOT_FOUND');
  }

  async listTags(clientId: string, tenantId: string) {
    await this.assertClientOwned(clientId, tenantId);
    if (this.useDb) {
      return this.admin.from('client_tags').select('*').eq('client_id', clientId).then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []).map(this.rowToTag);
      });
    }
    return Promise.resolve(
      client360Memory.tags.filter((t) => t.clientId === clientId && matchesTenant(t.tenantId, tenantId)),
    );
  }

  async addTag(clientId: string, tenantId: string, label: string, color?: string) {
    await this.assertClientOwned(clientId, tenantId);
    const trimmed = label.trim();
    if (!trimmed) throw new BadRequestError('Missing label', 'MISSING_FIELD');
    const tag: ClientTag = {
      id: uid('tag'), clientId, tenantId, label: trimmed, color: color || '#6366f1', createdAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('client_tags').insert({
        id: tag.id, client_id: clientId, label: tag.label, color: tag.color, created_at: tag.createdAt,
      });
      if (error) throw error;
    } else {
      client360Memory.tags.unshift(tag);
    }
    await this.logActivity(clientId, tenantId, { action: 'tag_added', newValue: trimmed });
    return tag;
  }

  async removeTag(clientId: string, tenantId: string, tagId: string) {
    await this.assertClientOwned(clientId, tenantId);
    if (this.useDb) {
      const { error } = await this.admin.from('client_tags').delete().eq('id', tagId).eq('client_id', clientId);
      if (error) throw error;
    } else {
      const idx = client360Memory.tags.findIndex(
        (t) => t.id === tagId && t.clientId === clientId && matchesTenant(t.tenantId, tenantId),
      );
      if (idx < 0) throw new NotFoundError('Tag not found', 'NOT_FOUND');
      client360Memory.tags.splice(idx, 1);
    }
    return { ok: true };
  }

  async listContacts(clientId: string, tenantId: string) {
    await this.assertClientOwned(clientId, tenantId);
    if (this.useDb) {
      return this.admin.from('client_alternate_contacts').select('*').eq('client_id', clientId).then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []).map(this.rowToContact);
      });
    }
    return Promise.resolve(
      client360Memory.contacts.filter((c) => c.clientId === clientId && matchesTenant(c.tenantId, tenantId)),
    );
  }

  async addContact(clientId: string, tenantId: string, body: Record<string, unknown>) {
    await this.assertClientOwned(clientId, tenantId);
    const contact: AlternateContact = {
      id: uid('ctc'),
      clientId,
      tenantId,
      name: body.name ? String(body.name) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      email: body.email ? String(body.email) : undefined,
      channel: (String(body.channel || 'whatsapp') as AlternateContact['channel']),
      isPrimary: Boolean(body.isPrimary),
      createdAt: stamp(),
    };
    if (!contact.phone && !contact.email) {
      throw new BadRequestError('phone or email required', 'MISSING_FIELD');
    }
    if (this.useDb) {
      const { error } = await this.admin.from('client_alternate_contacts').insert({
        id: contact.id, client_id: clientId, name: contact.name ?? null, phone: contact.phone ?? null,
        email: contact.email ?? null, channel: contact.channel, is_primary: contact.isPrimary,
      });
      if (error) throw error;
    } else {
      client360Memory.contacts.unshift(contact);
    }
    return contact;
  }

  async listDocuments(clientId: string, tenantId: string) {
    await this.assertClientOwned(clientId, tenantId);
    if (this.useDb) {
      return this.admin.from('client_documents').select('*').eq('client_id', clientId).then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []).map(this.rowToDocument);
      });
    }
    return Promise.resolve(
      client360Memory.documents.filter((d) => d.clientId === clientId && matchesTenant(d.tenantId, tenantId)),
    );
  }

  async addDocument(clientId: string, tenantId: string, body: Record<string, unknown>, uploadedBy?: string) {
    await this.assertClientOwned(clientId, tenantId);
    const fileName = String(body.fileName || '').trim();
    if (!fileName) throw new BadRequestError('Missing fileName', 'MISSING_FIELD');

    // El id lo emite `prepareDocumentUpload` y de él cuelga la ruta del objeto.
    // Es obligatorio: sin él no hay forma de saber qué objeto se acaba de subir,
    // y generarlo aquí produciría una fila apuntando a una ruta vacía.
    const documentId = String(body.documentId || '').trim();
    if (!documentId) throw new BadRequestError('Missing documentId', 'MISSING_FIELD');
    // La forma exacta que emite `prepareDocumentUpload`, no un `[\w-]{1,64}`
    // cualquiera: con `-` legal dentro del id, un id podía absorber el prefijo
    // del nombre y hacer que dos documentos compartieran ruta. Ver
    // DOCUMENT_ID_PATTERN.
    if (!isEmittedDocumentId(documentId)) {
      throw new BadRequestError('Invalid documentId', 'INVALID_FIELD');
    }

    const docType = String(body.docType || 'other');
    // Los contratos los crea sólo la RPC de firma, en SQL directo. Que un rol de
    // escritura pudiera fabricarlos por API convertía la guardia de inmutabilidad
    // del DELETE en algo que cualquiera puede aplicarse a un documento arbitrario.
    if (docType === 'contract') {
      throw new BadRequestError(
        "doc_type 'contract' está reservado: los contratos los emite el flujo de firma.",
        'DOC_TYPE_RESERVED',
      );
    }
    if (!DOCUMENT_TYPES.includes(docType as ClientDocument['docType'])) {
      throw new BadRequestError(
        `docType no permitido. Admitidos: ${ASSIGNABLE_DOCUMENT_TYPES.join(', ')}`,
        'INVALID_FIELD',
      );
    }

    // La ruta NO se lee del cuerpo. Se deriva con la misma función que la
    // construyó al firmar, así que siempre corresponde a este tenant, a este
    // cliente y a este documento. El aislamiento deja de ser una validación que
    // hay que acordarse de repetir y pasa a ser propiedad de construcción: no
    // existe forma de que la fila apunte al objeto de otro documento.
    // Un `storagePath` en el cuerpo se ignora.
    const storagePath = buildDocumentPath(tenantId, clientId, documentId, fileName);

    const doc: ClientDocument = {
      id: documentId,
      clientId,
      tenantId,
      docType: docType as ClientDocument['docType'],
      fileName,
      storagePath,
      mimeType: body.mimeType ? String(body.mimeType) : undefined,
      uploadedBy,
      createdAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('client_documents').insert({
        id: doc.id, client_id: clientId, tenant_id: tenantId,
        doc_type: doc.docType, file_name: doc.fileName,
        storage_path: doc.storagePath ?? null, mime_type: doc.mimeType ?? null, uploaded_by: uploadedBy ?? null,
      });
      if (error) throw error;
    } else {
      client360Memory.documents.unshift(doc);
    }
    await this.logActivity(clientId, tenantId, { action: 'document_added', newValue: fileName });
    return doc;
  }

  // ── Storage ────────────────────────────────────────────────────────
  //
  // El backend no recibe los bytes: firma una URL de subida y el navegador
  // sube directo al bucket. `documentId` se devuelve para que el registro de
  // metadatos posterior reutilice el mismo id que ya está en la ruta.

  async prepareDocumentUpload(clientId: string, tenantId: string, body: Record<string, unknown>) {
    await this.assertClientOwned(clientId, tenantId);
    if (!isStorageConfigured()) {
      throw new BadRequestError(
        'Storage no configurado. Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.',
        'STORAGE_UNAVAILABLE',
      );
    }

    const fileName = String(body.fileName || '').trim();
    if (!fileName) throw new BadRequestError('Missing fileName', 'MISSING_FIELD');

    const mimeType = String(body.mimeType || '').trim();
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(mimeType as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])) {
      throw new BadRequestError(
        `mimeType no permitido. Admitidos: ${ALLOWED_DOCUMENT_MIME_TYPES.join(', ')}`,
        'INVALID_MIME_TYPE',
      );
    }

    // El bucket ya impone el límite; validarlo aquí evita firmar una URL para
    // una subida que Storage va a rechazar igualmente.
    const sizeBytes = body.sizeBytes !== undefined ? Number(body.sizeBytes) : undefined;
    if (sizeBytes !== undefined && (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_DOCUMENT_BYTES)) {
      throw new BadRequestError(`sizeBytes fuera de rango (máx ${MAX_DOCUMENT_BYTES})`, 'INVALID_SIZE');
    }

    const documentId = uid('doc');
    const storagePath = buildDocumentPath(tenantId, clientId, documentId, fileName);
    const signed = await createDocumentUploadUrl(storagePath);
    return { documentId, fileName, mimeType, ...signed };
  }

  async getDocumentDownloadUrl(clientId: string, tenantId: string, documentId: string) {
    await this.assertClientOwned(clientId, tenantId);
    if (!isStorageConfigured()) {
      throw new BadRequestError('Storage no configurado.', 'STORAGE_UNAVAILABLE');
    }

    const documents = await this.listDocuments(clientId, tenantId);
    const doc = documents.find((d) => d.id === documentId);
    if (!doc) throw new NotFoundError('Document not found', 'NOT_FOUND');
    if (!doc.storagePath) {
      throw new NotFoundError('El documento no tiene archivo asociado', 'NO_STORAGE_OBJECT');
    }

    // Segunda barrera: `listDocuments` filtra por cliente, pero un storage_path
    // sembrado con otro prefijo no debe poder firmarse desde este tenant.
    if (!pathBelongsToTenant(doc.storagePath, tenantId)) {
      throw new NotFoundError('Document not found', 'NOT_FOUND');
    }

    const signed = await createDocumentDownloadUrl(doc.storagePath);
    return { documentId, fileName: doc.fileName, mimeType: doc.mimeType, ...signed };
  }

  /**
   * Baja de un documento: primero la fila, después —y sólo si procede— el objeto.
   * Ese orden deja como peor caso un objeto huérfano en el bucket, que es basura;
   * el inverso dejaría una fila apuntando a bytes que ya no existen, que es
   * corrupción visible para el usuario.
   */
  async deleteDocument(clientId: string, tenantId: string, documentId: string) {
    await this.assertClientOwned(clientId, tenantId);

    // `listDocuments` ya filtra por cliente y por tenant: un documentId de otro
    // WISP simplemente no aparece.
    const documents = await this.listDocuments(clientId, tenantId);
    const doc = documents.find((d) => d.id === documentId);
    if (!doc) throw new NotFoundError('Document not found', 'NOT_FOUND');

    // El PDF de un contrato es la única prueba de lo que se firmó: se anula, no
    // se borra. La guardia mira el archivo, no sólo el tipo, porque las filas
    // fantasma que dejó la UI anterior también son `contract` — con
    // `storage_path` NULL— y ésas sí hay que poder limpiarlas.
    if (doc.docType === 'contract' && doc.storagePath) {
      throw new ConflictError(
        'El documento de un contrato no se borra: los contratos se anulan.',
        'CONTRACT_DOCUMENT_IMMUTABLE',
      );
    }

    const retention = await this.objectRetentionReason(doc, tenantId);

    if (this.useDb) {
      const { error } = await this.admin
        .from('client_documents')
        .delete()
        .eq('id', documentId)
        .eq('client_id', clientId);
      if (error) throw error;
    } else {
      const idx = client360Memory.documents.findIndex(
        (d) => d.id === documentId && d.clientId === clientId && matchesTenant(d.tenantId, tenantId),
      );
      if (idx < 0) throw new NotFoundError('Document not found', 'NOT_FOUND');
      client360Memory.documents.splice(idx, 1);
    }

    await this.logActivity(clientId, tenantId, {
      action: 'document_removed',
      oldValue: doc.fileName,
    });

    const objectRemoved = retention === null ? await removeDocumentObject(doc.storagePath!) : false;

    return {
      ok: true,
      documentId,
      storagePath: doc.storagePath ?? null,
      objectRemoved,
      objectRetainedReason: retention,
    };
  }

  /**
   * Por qué NO tocar el objeto de esta fila, o `null` si sí hay que borrarlo.
   * Se resuelve antes de borrar la fila: después ya no se puede contar quién más
   * referencia la ruta.
   */
  private async objectRetentionReason(
    doc: ClientDocument,
    tenantId: string,
  ): Promise<'no_storage_object' | 'foreign_tenant_path' | 'shared_by_other_documents' | 'storage_unavailable' | null> {
    if (!doc.storagePath) return 'no_storage_object';

    // Segunda barrera de tenant, la misma que usa la descarga: la ruta de una
    // fila antigua pudo escribirse cuando el backend aceptaba la del cliente.
    if (!pathBelongsToTenant(doc.storagePath, tenantId)) return 'foreign_tenant_path';

    // Defensa en profundidad para las filas que ya existen en staging y
    // producción: con la ruta derivada no se pueden crear alias nuevos, pero los
    // viejos siguen ahí y borrar uno no debe llevarse los bytes del otro.
    const others = await this.countOtherRowsWithStoragePath(doc.storagePath, doc.id);
    if (others > 0) return 'shared_by_other_documents';

    if (!isStorageConfigured()) return 'storage_unavailable';
    return null;
  }

  /** Filas —de cualquier cliente o tenant— que apuntan a la misma ruta. */
  private async countOtherRowsWithStoragePath(storagePath: string, excludeId: string): Promise<number> {
    if (this.useDb) {
      const { data, error } = await this.admin
        .from('client_documents')
        .select('id')
        .eq('storage_path', storagePath)
        .neq('id', excludeId);
      if (error) throw error;
      return (data ?? []).length;
    }
    return client360Memory.documents.filter(
      (d) => d.storagePath === storagePath && d.id !== excludeId,
    ).length;
  }

  /**
   * Compensación del objeto huérfano: la subida a Storage salió bien pero el
   * registro de metadatos falló, así que no hay fila y `deleteDocument` no puede
   * resolver la ruta.
   *
   * El cuerpo trae `{documentId, fileName}` y **no** una ruta: se recalcula con
   * la misma función que la construyó al firmar. Así este endpoint no puede
   * apuntar a un objeto que no le corresponde, ni siquiera dentro del tenant.
   */
  async cleanupOrphanDocumentObject(clientId: string, tenantId: string, body: Record<string, unknown>) {
    await this.assertClientOwned(clientId, tenantId);

    const documentId = String(body.documentId || '').trim();
    if (!documentId) throw new BadRequestError('Missing documentId', 'MISSING_FIELD');
    // Mismo anclaje que `addDocument`: sin él, un id con `-` extra deriva la
    // ruta de OTRO documento y este endpoint pasa a poder señalarla.
    if (!isEmittedDocumentId(documentId)) {
      throw new BadRequestError('Invalid documentId', 'INVALID_FIELD');
    }
    const fileName = String(body.fileName || '').trim();
    if (!fileName) throw new BadRequestError('Missing fileName', 'MISSING_FIELD');

    const storagePath = buildDocumentPath(tenantId, clientId, documentId, fileName);

    // Redundante por construcción —el primer segmento es el tenant saneado—,
    // pero es la barrera que el resto del dominio aplica antes de tocar un
    // objeto, y quitarla dejaría este camino dependiendo sólo de que nadie
    // cambie `buildDocumentPath`.
    if (!pathBelongsToTenant(storagePath, tenantId)) {
      throw new BadRequestError('storagePath fuera del tenant', 'INVALID_FIELD');
    }

    // Sin esto, esto sería un borrado de documentos encubierto: llegaría al
    // objeto de una fila viva sin pasar por la guardia de contratos del DELETE.
    const referencing = await this.countRowsReferencing(documentId, storagePath);
    if (referencing > 0) {
      throw new ConflictError(
        'El objeto está referenciado por un documento registrado: no es huérfano.',
        'DOCUMENT_NOT_ORPHAN',
      );
    }

    if (!isStorageConfigured()) {
      throw new BadRequestError('Storage no configurado.', 'STORAGE_UNAVAILABLE');
    }

    const removed = await removeDocumentObject(storagePath);
    await this.logActivity(clientId, tenantId, {
      action: 'document_orphan_cleanup',
      oldValue: fileName,
    });
    return { ok: true, documentId, storagePath, removed };
  }

  /** Filas que referencian el objeto, por id o por ruta. */
  private async countRowsReferencing(documentId: string, storagePath: string): Promise<number> {
    if (this.useDb) {
      const [byId, byPath] = await Promise.all([
        this.admin.from('client_documents').select('id').eq('id', documentId),
        this.admin.from('client_documents').select('id').eq('storage_path', storagePath),
      ]);
      if (byId.error) throw byId.error;
      if (byPath.error) throw byPath.error;
      return new Set([...(byId.data ?? []), ...(byPath.data ?? [])].map((r) => String(r.id))).size;
    }
    return client360Memory.documents.filter(
      (d) => d.id === documentId || d.storagePath === storagePath,
    ).length;
  }

  async listActivity(clientId: string, tenantId: string, limit = 50) {
    await this.assertClientOwned(clientId, tenantId);
    if (this.useDb) {
      return this.admin.from('client_activity_log').select('*').eq('client_id', clientId)
        .order('created_at', { ascending: false }).limit(limit).then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []).map(this.rowToActivity);
        });
    }
    return Promise.resolve(
      client360Memory.activity
        .filter((a) => a.clientId === clientId && matchesTenant(a.tenantId, tenantId))
        .slice(0, limit),
    );
  }

  async logActivity(
    clientId: string,
    tenantId: string,
    entry: Partial<ActivityLogEntry> & { action: string },
    actor?: { id?: string; role?: string },
  ) {
    const row: ActivityLogEntry = {
      id: uid('act'),
      clientId,
      tenantId,
      actorId: actor?.id ?? entry.actorId,
      actorRole: actor?.role ?? entry.actorRole,
      action: entry.action,
      fieldName: entry.fieldName,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      reason: entry.reason,
      createdAt: stamp(),
    };
    if (this.useDb) {
      await this.admin.from('client_activity_log').insert({
        id: row.id, client_id: clientId, actor_id: row.actorId ?? null, actor_role: row.actorRole ?? null,
        action: row.action, field_name: row.fieldName ?? null, old_value: row.oldValue ?? null,
        new_value: row.newValue ?? null, reason: row.reason ?? null, created_at: row.createdAt,
      });
    } else {
      client360Memory.activity.unshift(row);
    }
    return row;
  }

  async getExpediente(clientId: string, tenantId: string) {
    await this.assertClientOwned(clientId, tenantId);
    const [tags, contacts, documents, activity] = await Promise.all([
      this.listTags(clientId, tenantId),
      this.listContacts(clientId, tenantId),
      this.listDocuments(clientId, tenantId),
      this.listActivity(clientId, tenantId, 30),
    ]);
    return { clientId, tags, contacts, documents, activity };
  }

  private rowToTag(row: Record<string, unknown>): ClientTag {
    return {
      id: String(row.id), clientId: String(row.client_id), label: String(row.label),
      color: String(row.color ?? '#6366f1'), createdAt: String(row.created_at),
      tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
    };
  }

  private rowToContact(row: Record<string, unknown>): AlternateContact {
    return {
      id: String(row.id), clientId: String(row.client_id),
      name: row.name ? String(row.name) : undefined,
      phone: row.phone ? String(row.phone) : undefined,
      email: row.email ? String(row.email) : undefined,
      channel: row.channel as AlternateContact['channel'],
      isPrimary: Boolean(row.is_primary), createdAt: String(row.created_at),
      tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
    };
  }

  private rowToDocument(row: Record<string, unknown>): ClientDocument {
    return {
      id: String(row.id), clientId: String(row.client_id),
      docType: row.doc_type as ClientDocument['docType'],
      fileName: String(row.file_name),
      storagePath: row.storage_path ? String(row.storage_path) : undefined,
      mimeType: row.mime_type ? String(row.mime_type) : undefined,
      uploadedBy: row.uploaded_by ? String(row.uploaded_by) : undefined,
      createdAt: String(row.created_at),
      tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
    };
  }

  private rowToActivity(row: Record<string, unknown>): ActivityLogEntry {
    return {
      id: String(row.id), clientId: String(row.client_id),
      actorId: row.actor_id ? String(row.actor_id) : undefined,
      actorRole: row.actor_role ? String(row.actor_role) : undefined,
      action: String(row.action),
      fieldName: row.field_name ? String(row.field_name) : undefined,
      oldValue: row.old_value ? String(row.old_value) : undefined,
      newValue: row.new_value ? String(row.new_value) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
      createdAt: String(row.created_at),
      tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
    };
  }
}

let cached: Client360Service | null = null;
export const getClient360Service = () => {
  if (!cached) cached = new Client360Service();
  return cached;
};

import { isDomainOnDb } from '../../config/feature-flags';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import {
  client360Memory,
  uid,
  stamp,
  type ActivityLogEntry,
  type AlternateContact,
  type ClientDocument,
  type ClientTag,
} from './memory-store';

export class Client360Service {
  private useDb = isDomainOnDb('customers') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase admin client not configured');
    return supabaseAdmin;
  }

  listTags(clientId: string) {
    if (this.useDb) {
      return this.admin.from('client_tags').select('*').eq('client_id', clientId).then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []).map(this.rowToTag);
      });
    }
    return Promise.resolve(client360Memory.tags.filter((t) => t.clientId === clientId));
  }

  async addTag(clientId: string, label: string, color?: string) {
    const trimmed = label.trim();
    if (!trimmed) throw new BadRequestError('Missing label', 'MISSING_FIELD');
    const tag: ClientTag = { id: uid('tag'), clientId, label: trimmed, color: color || '#6366f1', createdAt: stamp() };
    if (this.useDb) {
      const { error } = await this.admin.from('client_tags').insert({
        id: tag.id, client_id: clientId, label: tag.label, color: tag.color, created_at: tag.createdAt,
      });
      if (error) throw error;
    } else {
      client360Memory.tags.unshift(tag);
    }
    await this.logActivity(clientId, { action: 'tag_added', newValue: trimmed });
    return tag;
  }

  async removeTag(clientId: string, tagId: string) {
    if (this.useDb) {
      const { error } = await this.admin.from('client_tags').delete().eq('id', tagId).eq('client_id', clientId);
      if (error) throw error;
    } else {
      const idx = client360Memory.tags.findIndex((t) => t.id === tagId && t.clientId === clientId);
      if (idx < 0) throw new NotFoundError('Tag not found', 'NOT_FOUND');
      client360Memory.tags.splice(idx, 1);
    }
    return { ok: true };
  }

  listContacts(clientId: string) {
    if (this.useDb) {
      return this.admin.from('client_alternate_contacts').select('*').eq('client_id', clientId).then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []).map(this.rowToContact);
      });
    }
    return Promise.resolve(client360Memory.contacts.filter((c) => c.clientId === clientId));
  }

  async addContact(clientId: string, body: Record<string, unknown>) {
    const contact: AlternateContact = {
      id: uid('ctc'),
      clientId,
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

  listDocuments(clientId: string) {
    if (this.useDb) {
      return this.admin.from('client_documents').select('*').eq('client_id', clientId).then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []).map(this.rowToDocument);
      });
    }
    return Promise.resolve(client360Memory.documents.filter((d) => d.clientId === clientId));
  }

  async addDocument(clientId: string, body: Record<string, unknown>, uploadedBy?: string) {
    const fileName = String(body.fileName || '').trim();
    if (!fileName) throw new BadRequestError('Missing fileName', 'MISSING_FIELD');
    const doc: ClientDocument = {
      id: uid('doc'),
      clientId,
      docType: (String(body.docType || 'other') as ClientDocument['docType']),
      fileName,
      storagePath: body.storagePath ? String(body.storagePath) : undefined,
      mimeType: body.mimeType ? String(body.mimeType) : undefined,
      uploadedBy,
      createdAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('client_documents').insert({
        id: doc.id, client_id: clientId, doc_type: doc.docType, file_name: doc.fileName,
        storage_path: doc.storagePath ?? null, mime_type: doc.mimeType ?? null, uploaded_by: uploadedBy ?? null,
      });
      if (error) throw error;
    } else {
      client360Memory.documents.unshift(doc);
    }
    await this.logActivity(clientId, { action: 'document_added', newValue: fileName });
    return doc;
  }

  listActivity(clientId: string, limit = 50) {
    if (this.useDb) {
      return this.admin.from('client_activity_log').select('*').eq('client_id', clientId)
        .order('created_at', { ascending: false }).limit(limit).then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []).map(this.rowToActivity);
        });
    }
    return Promise.resolve(
      client360Memory.activity.filter((a) => a.clientId === clientId).slice(0, limit),
    );
  }

  async logActivity(clientId: string, entry: Partial<ActivityLogEntry> & { action: string }, actor?: { id?: string; role?: string }) {
    const row: ActivityLogEntry = {
      id: uid('act'),
      clientId,
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

  async getExpediente(clientId: string) {
    const [tags, contacts, documents, activity] = await Promise.all([
      this.listTags(clientId),
      this.listContacts(clientId),
      this.listDocuments(clientId),
      this.listActivity(clientId, 30),
    ]);
    return { clientId, tags, contacts, documents, activity };
  }

  private rowToTag(row: Record<string, unknown>): ClientTag {
    return {
      id: String(row.id), clientId: String(row.client_id), label: String(row.label),
      color: String(row.color ?? '#6366f1'), createdAt: String(row.created_at),
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
    };
  }
}

let cached: Client360Service | null = null;
export const getClient360Service = () => {
  if (!cached) cached = new Client360Service();
  return cached;
};

-- ====================================================================
-- Storage: bucket `client-documents` (expediente del cliente)
--
-- Cierra la feature a medias: `client_documents.storage_path` existe desde
-- `20260707100000_wisp_os_schema` y el backend ya la valida y persiste, pero
-- no había bucket ni ninguna llamada a Storage. Se guardaba la referencia a un
-- archivo que nadie almacenaba.
--
-- MODELO DE ACCESO — idéntico al del resto del proyecto:
--   - Bucket PRIVADO (`public = false`). Nada es accesible por URL directa.
--   - Solo `service_role` toca `storage.objects` de este bucket. NO se crean
--     políticas para `anon`/`authenticated`: el navegador nunca habla con
--     Storage por su cuenta, igual que no habla con PostgREST.
--   - El backend Express valida RBAC + propiedad del cliente por tenant y
--     entrega URLs firmadas de vida corta (subida y descarga).
--
-- Convención de rutas: <tenant_id>/<client_id>/<document_id>-<archivo>
-- El prefijo por tenant hace que el aislamiento sea evidente en la propia
-- ruta y permite políticas por prefijo si algún día se abre a otros roles.
--
-- Límites en el propio bucket (defensa que no depende del backend):
--   - 10 MiB por objeto.
--   - Solo PDF e imágenes: son documentos de expediente (INE, comprobantes,
--     contratos firmados), no un almacén de archivos genérico.
-- ====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-documents',
  'client-documents',
  false,
  10485760, -- 10 MiB
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Política explícita de service_role, en línea con la convención del repo
-- (toda tabla con RLS lleva su `<recurso>_service_role`). Funcionalmente
-- redundante — service_role bypassa RLS — pero deja el permiso documentado en
-- `pg_policies` y evita que el bucket parezca huérfano en una auditoría.
DROP POLICY IF EXISTS client_documents_bucket_service_role ON storage.objects;

CREATE POLICY client_documents_bucket_service_role
  ON storage.objects
  FOR ALL
  USING ((select auth.role()) = 'service_role' AND bucket_id = 'client-documents')
  WITH CHECK ((select auth.role()) = 'service_role' AND bucket_id = 'client-documents');

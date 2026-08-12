-- ====================================================================
-- C1 — Contrato de servicios y firma presencial: fundación de datos.
--
-- Tres tablas y una RPC. NADIE LLAMA A LA RPC TODAVÍA: el backend que la
-- invoca es C3. Esta migración sólo deja el suelo puesto.
--
-- Lo que gobierna el diseño: **lo que se firma es un PDF concreto, no una**
-- **plantilla**. La plantilla es editable y viva; el contrato firmado es
-- inmutable y se identifica por el hash de los bytes almacenados. Por eso
-- `contracts` guarda las cláusulas YA renderizadas y el hash, y no una
-- referencia a la plantilla: editarla mañana no puede alterar lo ya firmado.
--
-- Tres cosas de esta migración son contraintuitivas y están aquí a propósito:
--
--   1. El lock de `contract_sign_apply` NO se toma sobre la evidencia. Con los
--      privilegios que declara el bloque de grants, `SELECT … FOR UPDATE`
--      sobre `contract_signature_evidence` da `permission denied`, porque
--      exige el privilegio UPDATE que es justo el que se revoca. Se serializa
--      sobre `clients` + `contracts` y la evidencia entra con
--      `ON CONFLICT (contract_id) DO NOTHING`, el único patrón que sobrevive.
--
--   2. El append-only de la evidencia lo dan los PRIVILEGIOS, no las
--      políticas: `service_role` tiene BYPASSRLS y las políticas no se le
--      evalúan. De ahí el REVOKE explícito, que se desvía a propósito de la
--      plantilla `FOR ALL` del repo.
--
--   3. `contracts.document_id … ON DELETE RESTRICT` es la pieza que blinda el
--      PDF firmado. Una cascada NO comprueba privilegios sobre la tabla hija,
--      así que el REVOKE no detendría el borrado del documento; el RESTRICT
--      sí, y sin tener que modificar `client_documents`, que es ajena.
--
-- Todo el DDL es idempotente: el gate PG17 aplica esta migración dos veces.
-- ====================================================================

-- ── 1. La plantilla, editable y versionada ──────────────────────────
--
-- Una por tenant. Las cláusulas van en JSONB ordenado y no en una tabla hija
-- porque siempre se leen y se escriben enteras: una hija sólo añadiría joins.
-- `version` sube en cada guardado y es lo que el contrato congela.

CREATE TABLE IF NOT EXISTS public.contract_templates (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL UNIQUE DEFAULT 'tenant-default'
                   REFERENCES public.tenants(id) ON DELETE RESTRICT,
  -- [{id, titulo, cuerpo, activa}] — el CHECK impide guardar un objeto suelto
  -- donde el renderizador espera recorrer una lista.
  clauses        JSONB NOT NULL DEFAULT '[]'::jsonb
                   CHECK (jsonb_typeof(clauses) = 'array'),
  version        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Flag POR TENANT, no por cliente: controla que el portal muestre el estado
  -- del contrato. No abre ninguna descarga.
  show_in_portal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.contract_templates IS
  'Plantilla de contrato por tenant. Editable y versionada; lo ya firmado no '
  'la referencia, así que editarla no altera ningún contrato existente.';

COMMENT ON COLUMN public.contract_templates.version IS
  'Sube en cada guardado. contracts.template_version guarda el valor con el '
  'que se generó, como dato histórico: NO es una clave foránea.';

-- ── 2. El contrato: texto congelado + estado ────────────────────────

CREATE TABLE IF NOT EXISTS public.contracts (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL DEFAULT 'tenant-default'
                     REFERENCES public.tenants(id) ON DELETE RESTRICT,
  -- RESTRICT, no CASCADE: un contrato firmado inmoviliza al cliente. La
  -- distinción draft/firmado NO puede vivir en la FK —un ON DELETE no se
  -- condiciona por estado— así que vive en la capa que borra; esto es la
  -- última línea.
  client_id        TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  template_version INTEGER NOT NULL CHECK (template_version >= 1),
  -- LA FUENTE DE VERDAD del texto firmado. De aquí salen el preview (un
  -- componente React) y el PDF. Congelado al generar.
  rendered_clauses JSONB NOT NULL DEFAULT '[]'::jsonb
                     CHECK (jsonb_typeof(rendered_clauses) = 'array'),
  -- Serialización plana de lo anterior: legible en la base y en un export.
  -- NADIE RENDERIZA DESDE AQUÍ. Si divergiera, manda rendered_clauses.
  rendered_text    TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'signed', 'voided')),
  -- El PDF firmado es un client_documents más, con doc_type='contract'.
  -- RESTRICT: ver la nota 3 de la cabecera.
  document_id      TEXT REFERENCES public.client_documents(id) ON DELETE RESTRICT,
  -- SHA-256 de los bytes EFECTIVAMENTE SUBIDOS. pdfkit no es determinista
  -- (/CreationDate, /ID), así que este hash no se puede recalcular desde
  -- rendered_clauses: la prueba de integridad es el par (bytes, hash).
  pdf_sha256       TEXT,
  signed_at        TIMESTAMPTZ,
  voided_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un contrato firmado sin PDF, sin hash o sin fecha no es un contrato
  -- firmado: es una fila que miente. La base lo impide aunque el llamador
  -- se equivoque.
  CONSTRAINT contracts_signed_requires_evidence CHECK (
    status <> 'signed'
    OR (document_id IS NOT NULL AND pdf_sha256 IS NOT NULL AND signed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.contracts IS
  'Contrato de servicios por cliente. El texto se congela al generar; el PDF '
  'firmado vive en client_documents y se identifica por pdf_sha256.';

-- UN SOLO CONTRATO FIRMADO VIGENTE POR CLIENTE.
--
-- Sin esto nada dice cuál rige y el portal no sabría qué fecha mostrar.
-- `contract_sign_apply` anula el vigente DENTRO de la misma transacción en la
-- que firma el nuevo, así que este índice nunca llega a ver dos filas.
CREATE UNIQUE INDEX IF NOT EXISTS contracts_one_signed_per_client
  ON public.contracts (client_id) WHERE status = 'signed';

-- Índices de cobertura de las claves foráneas (misma razón que
-- 20260717030000: una FK sin índice hace lenta la comprobación referencial y
-- el DELETE del padre).
CREATE INDEX IF NOT EXISTS idx_contracts_client_id ON public.contracts (client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_id ON public.contracts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_contracts_document_id
  ON public.contracts (document_id) WHERE document_id IS NOT NULL;

-- ── 3. La evidencia: append-only de verdad ──────────────────────────
--
-- Lo que esta fila atestigua es un ACTO PRESENCIAL CON TESTIGO, no la
-- identidad remota del firmante: la IP y el user-agent son los del técnico.
-- Por eso witness_user_id es NOT NULL — sin testigo identificado, el paquete
-- no prueba nada.

CREATE TABLE IF NOT EXISTS public.contract_signature_evidence (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'tenant-default'
                    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  -- UNIQUE: una firma, una evidencia. No es decorativo — es el arbiter que
  -- necesita el `ON CONFLICT (contract_id) DO NOTHING` de la RPC, que es el
  -- único patrón de idempotencia compatible con el REVOKE UPDATE de abajo.
  -- RESTRICT: un contrato con evidencia no se borra.
  contract_id     TEXT NOT NULL UNIQUE
                    REFERENCES public.contracts(id) ON DELETE RESTRICT,
  pdf_sha256      TEXT NOT NULL,
  -- DEL SERVIDOR, nunca del cliente: la RPC no acepta esta fecha como
  -- parámetro precisamente para que no pueda falsificarse desde el borde.
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  witness_user_id TEXT NOT NULL,
  witness_role    TEXT NOT NULL,
  signer_ip       TEXT,
  user_agent      TEXT,
  geo             JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.contract_signature_evidence IS
  'Paquete probatorio de una firma presencial. APPEND-ONLY: lo garantizan los '
  'privilegios de tabla (REVOKE UPDATE/DELETE/TRUNCATE), no las políticas RLS '
  '— service_role tiene BYPASSRLS y las políticas no se le evalúan.';

COMMENT ON COLUMN public.contract_signature_evidence.signer_ip IS
  'IP del DISPOSITIVO DEL TÉCNICO, no del firmante: la firma es presencial. '
  'Lo mismo vale para user_agent y geo.';

CREATE INDEX IF NOT EXISTS idx_contract_signature_evidence_tenant_id
  ON public.contract_signature_evidence (tenant_id);

-- ── 4. RLS: la convención del repo, sabiendo lo que NO protege ──────
--
-- El navegador nunca habla con PostgREST en este proyecto: todo pasa por
-- Express, que ya valida RBAC y resuelve el tenant. Estas políticas dejan el
-- permiso documentado en pg_policies y evitan que las tablas parezcan
-- huérfanas en una auditoría. NO son lo que hace append-only a la evidencia.

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_signature_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_templates_service_role ON public.contract_templates;
CREATE POLICY contract_templates_service_role ON public.contract_templates
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS contracts_service_role ON public.contracts;
CREATE POLICY contracts_service_role ON public.contracts
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- Desviación DELIBERADA de la plantilla `FOR ALL` del repo: aquí la política
-- se acota a lo que los privilegios ya permiten, para que leerla no sugiera
-- que la evidencia puede modificarse.
DROP POLICY IF EXISTS contract_signature_evidence_service_role
  ON public.contract_signature_evidence;
CREATE POLICY contract_signature_evidence_service_role
  ON public.contract_signature_evidence
  FOR SELECT
  TO service_role
  USING (TRUE);

DROP POLICY IF EXISTS contract_signature_evidence_service_role_insert
  ON public.contract_signature_evidence;
CREATE POLICY contract_signature_evidence_service_role_insert
  ON public.contract_signature_evidence
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

-- ── 5. La RPC: firmar es una sola transacción ───────────────────────
--
-- No hay `pg`, `knex` ni `drizzle` en el proyecto: todo pasa por PostgREST y
-- cada `.insert()` es su propia transacción. Escribir el documento, marcar el
-- contrato, anular el vigente y registrar la evidencia en cuatro llamadas
-- dejaría cuatro puntos donde el estado puede quedarse a medias. Aquí es una.
--
-- ORDEN DE LOCKS: `clients` → `contracts`. Ese orden no es arbitrario:
--   * `clients` primero porque es lo que serializa DOS FIRMAS DISTINTAS DEL
--     MISMO CLIENTE. Sin él, dos contratos en draft firmados a la vez no se
--     ven entre sí, ninguno anula al otro y el segundo muere con un 23505
--     opaco contra el índice parcial en vez de anular al primero, que es la
--     semántica decidida.
--   * y en ESE orden porque `customers_delete_cascade` (20260806120000)
--     bloquea también `clients` primero. Invertirlo aquí abriría un ciclo
--     firma/borrado y con él deadlocks.
--   * la evidencia NO se bloquea: `SELECT … FOR UPDATE` sobre ella exige el
--     privilegio UPDATE, que se revoca más abajo. Ver la cabecera.
--
-- IDEMPOTENTE POR CONTRATO: si ya estaba firmado devuelve el document_id y el
-- pdf_sha256 de la PRIMERA firma con `already_signed = true`, sin escribir
-- nada. Esa marca no es cosmética: el backend la usa para compensar el PDF
-- que él subió y que acaba de perder la carrera, y para avisar al técnico en
-- vez de darle una confirmación que sería mentira.

CREATE OR REPLACE FUNCTION public.contract_sign_apply(
  p_tenant_id       TEXT,
  p_contract_id     TEXT,
  p_document_id     TEXT,
  p_file_name       TEXT,
  p_storage_path    TEXT,
  p_mime_type       TEXT,
  p_pdf_sha256      TEXT,
  p_witness_user_id TEXT,
  p_witness_role    TEXT,
  p_signer_ip       TEXT DEFAULT NULL,
  p_user_agent      TEXT DEFAULT NULL,
  p_geo             JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id   TEXT;
  v_status      TEXT;
  v_document_id TEXT;
  v_pdf_sha256  TEXT;
  v_signed_at   TIMESTAMPTZ;
  v_voided      TEXT[];
BEGIN
  -- El tenant no es un filtro opcional. Aceptar NULL como comodín convertiría
  -- esta RPC SECURITY INVOKER en una vía para firmar filas de otro WISP si el
  -- llamador omitiera el contexto por error.
  IF p_tenant_id IS NULL OR btrim(p_tenant_id) = '' THEN
    RAISE EXCEPTION 'contract_sign_apply: invalid_tenant_id';
  END IF;
  IF p_contract_id IS NULL OR btrim(p_contract_id) = '' THEN
    RAISE EXCEPTION 'contract_sign_apply: invalid_contract_id';
  END IF;
  IF p_document_id IS NULL OR btrim(p_document_id) = ''
     OR p_file_name IS NULL OR btrim(p_file_name) = ''
     OR p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'contract_sign_apply: invalid_document';
  END IF;
  -- Un hash vacío haría pasar por verificable un PDF que no lo es.
  IF p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'contract_sign_apply: invalid_pdf_sha256';
  END IF;
  -- Lo que la evidencia atestigua es un acto presencial CON TESTIGO. Sin
  -- testigo identificado no hay nada que atestiguar.
  IF p_witness_user_id IS NULL OR btrim(p_witness_user_id) = ''
     OR p_witness_role IS NULL OR btrim(p_witness_role) = '' THEN
    RAISE EXCEPTION 'contract_sign_apply: invalid_witness';
  END IF;

  -- ── Lock 1: el cliente. Serializa firmas simultáneas de contratos
  -- DISTINTOS del mismo cliente, que es el caso que el índice parcial no
  -- puede resolver por sí solo sin abortar a uno con un error opaco.
  SELECT c.client_id INTO v_client_id
   FROM public.contracts c
   WHERE c.id = p_contract_id
     AND c.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    -- Contrato inexistente y contrato de otro tenant son indistinguibles a
    -- propósito: no filtra la existencia de filas ajenas.
    RAISE EXCEPTION 'contract_sign_apply: contract_not_found: %', p_contract_id;
  END IF;

  PERFORM 1 FROM public.clients cl
   WHERE cl.id = v_client_id
     AND cl.tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract_sign_apply: client_not_found: %', v_client_id;
  END IF;

  -- ── Lock 2: el contrato. Releído BAJO LOCK: entre la lectura de arriba y
  -- este punto otra transacción pudo firmarlo, y es exactamente el caso que
  -- la idempotencia tiene que ver.
  SELECT c.client_id, c.status, c.document_id, c.pdf_sha256, c.signed_at
    INTO v_client_id, v_status, v_document_id, v_pdf_sha256, v_signed_at
   FROM public.contracts c
   WHERE c.id = p_contract_id
     AND c.tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract_sign_apply: contract_not_found: %', p_contract_id;
  END IF;

  -- ── Ya firmado: se devuelve la PRIMERA firma y no se escribe nada ──
  IF v_status = 'signed' THEN
    RETURN jsonb_build_object(
      'contract_id',        p_contract_id,
      'client_id',          v_client_id,
      'document_id',        v_document_id,
      'pdf_sha256',         v_pdf_sha256,
      'signed_at',          v_signed_at,
      'already_signed',     true,
      'voided_contract_ids', '[]'::jsonb
    );
  END IF;

  -- Un contrato anulado no se re-firma: se genera uno nuevo. Volver a firmar
  -- éste dejaría su evidencia vieja apuntando a otro PDF.
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'contract_sign_apply: contract_not_signable: %', v_status;
  END IF;

  -- ── Anular el vigente, ANTES de firmar el nuevo ────────────────────
  -- En la misma transacción, y en este orden, para que
  -- `contracts_one_signed_per_client` nunca llegue a ver dos filas 'signed'.
  -- El contrato anulado NO se borra ni pierde su evidencia: 'voided'
  -- significa "ya no rige", no "no existió".
  WITH voided AS (
    UPDATE public.contracts c
       SET status     = 'voided',
           voided_at  = now(),
           updated_at = now()
     WHERE c.client_id = v_client_id
       AND c.tenant_id = p_tenant_id
       AND c.status = 'signed'
       AND c.id <> p_contract_id
    RETURNING c.id
  )
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::TEXT[]) INTO v_voided FROM voided;

  -- ── El PDF firmado entra al expediente ─────────────────────────────
  -- client_id y tenant_id salen del CONTRATO, no de parámetros: así el
  -- documento no puede acabar colgando de un cliente que no es el suyo.
  INSERT INTO public.client_documents (
    id, client_id, tenant_id, doc_type, file_name, storage_path, mime_type,
    uploaded_by, name
  )
  SELECT p_document_id, c.client_id, c.tenant_id, 'contract', p_file_name,
         p_storage_path, p_mime_type, p_witness_user_id, p_file_name
    FROM public.contracts c
   WHERE c.id = p_contract_id;

  UPDATE public.contracts c
     SET status      = 'signed',
         document_id = p_document_id,
         pdf_sha256  = p_pdf_sha256,
         signed_at   = now(),
         updated_at  = now()
   WHERE c.id = p_contract_id
  RETURNING c.signed_at INTO v_signed_at;

  -- ── La evidencia ───────────────────────────────────────────────────
  -- `ON CONFLICT (contract_id) DO NOTHING` es el ÚNICO patrón de idempotencia
  -- que sobrevive al REVOKE UPDATE: `DO UPDATE` exige el privilegio UPDATE y
  -- daría `permission denied` en producción, firmando.
  INSERT INTO public.contract_signature_evidence (
    id, tenant_id, contract_id, pdf_sha256, signed_at,
    witness_user_id, witness_role, signer_ip, user_agent, geo
  )
  SELECT 'cse-' || p_contract_id, c.tenant_id, p_contract_id, p_pdf_sha256,
         v_signed_at, p_witness_user_id, p_witness_role, p_signer_ip,
         p_user_agent, p_geo
    FROM public.contracts c
   WHERE c.id = p_contract_id
  ON CONFLICT (contract_id) DO NOTHING;

  RETURN jsonb_build_object(
    'contract_id',        p_contract_id,
    'client_id',          v_client_id,
    'document_id',        p_document_id,
    'pdf_sha256',         p_pdf_sha256,
    'signed_at',          v_signed_at,
    'already_signed',     false,
    'voided_contract_ids', to_jsonb(v_voided)
  );
END;
$$;

COMMENT ON FUNCTION public.contract_sign_apply(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) IS
  'Firma un contrato en una sola transacción: registra el PDF en '
  'client_documents, marca el contrato como signed, anula el firmado vigente '
  'del mismo cliente y guarda la evidencia. Idempotente por contract_id: si ya '
  'estaba firmado devuelve la primera firma con already_signed = true.';

REVOKE ALL ON FUNCTION public.contract_sign_apply(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_sign_apply(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;

-- ── 6. Privilegios ──────────────────────────────────────────────────
--
-- SECURITY INVOKER needs real table privileges; never rely on bootstrap-wide
-- grants. Y `client_documents` NO tenía ningún privilegio de escritura
-- declarado en ninguna migración: sin este bloque la RPC daría
-- `permission denied` al insertar el PDF firmado.

GRANT USAGE ON SCHEMA public TO service_role;

-- La plantilla se crea al primer guardado y se sobrescribe después; no se
-- borra (quitar la fila devolvería al tenant a "sin plantilla" en silencio).
GRANT SELECT, INSERT, UPDATE ON TABLE public.contract_templates TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.contract_templates FROM service_role;

-- DELETE sí: un `draft` es un papel sin firmar —sin PDF, sin hash, sin
-- evidencia— y se puede borrar. Lo firmado no; de eso se encarga la capa que
-- borra, con el RESTRICT de la evidencia como última línea.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contracts TO service_role;
REVOKE TRUNCATE ON TABLE public.contracts FROM service_role;

-- ── EL REVOKE QUE HACE APPEND-ONLY A LA EVIDENCIA ──
--
-- Desviación DELIBERADA de la plantilla `FOR ALL` del repo. `service_role`
-- tiene BYPASSRLS: las políticas NO se le evalúan, así que una política
-- restrictiva no protegería nada. Lo que sí muerde son los privilegios de
-- tabla, que aplican también a los roles con BYPASSRLS.
--
-- Verificado: un `_reapply.sql` futuro no deshace esto — el generador del
-- SSOT emite ALTER/CREATE POLICY y ni un solo GRANT.
--
-- El precio está en la RPC: sin UPDATE, `SELECT … FOR UPDATE` e
-- `INSERT … ON CONFLICT DO UPDATE` sobre esta tabla dan `permission denied`.
GRANT SELECT, INSERT ON TABLE public.contract_signature_evidence TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.contract_signature_evidence
  FROM service_role;

-- INSERT y nada más: la RPC escribe el PDF firmado en el expediente y no lee
-- ni modifica nada de esta tabla. El SELECT que el resto del backend usa lo
-- concede 20260806120000; declararlo aquí sería regalar alcance que esta
-- migración no necesita.
GRANT INSERT ON TABLE public.client_documents TO service_role;

-- UPDATE no es para escribir: `SELECT … FOR UPDATE` exige el privilegio
-- UPDATE aunque la fila nunca se modifique. Es el lock que serializa dos
-- firmas del mismo cliente.
GRANT SELECT, UPDATE ON TABLE public.clients TO service_role;

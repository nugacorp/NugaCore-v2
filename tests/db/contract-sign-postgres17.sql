\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

-- Appendix-only debe sostenerse por ACL incluso si RLS no participa.
DO $$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.contract_signature_evidence', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.contract_signature_evidence', 'INSERT')
     OR has_table_privilege('service_role', 'public.contract_signature_evidence', 'UPDATE')
     OR has_table_privilege('service_role', 'public.contract_signature_evidence', 'DELETE')
     OR has_table_privilege('service_role', 'public.contract_signature_evidence', 'TRUNCATE') THEN
    RAISE EXCEPTION 'ACL de evidencia no es append-only';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.contracts', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('service_role', 'public.client_documents', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.clients', 'SELECT,UPDATE')
     OR NOT has_function_privilege(
       'service_role',
       'public.contract_sign_apply(text,text,text,text,text,text,text,text,text,text,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'faltan privilegios mínimos para la RPC';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.contract_sign_apply(text,text,text,text,text,text,text,text,text,text,text,jsonb)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.contract_sign_apply(text,text,text,text,text,text,text,text,text,text,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'la RPC quedó expuesta a un rol público';
  END IF;
END $$;

INSERT INTO public.clients (id, full_name, address, city, tenant_id) VALUES
  ('client-race', 'Race', 'Uno', 'Tijuana', 'tenant-a'),
  ('client-replace', 'Replace', 'Dos', 'Tijuana', 'tenant-a'),
  ('client-draft', 'Draft', 'Tres', 'Tijuana', 'tenant-a');

INSERT INTO public.contracts (
  id, tenant_id, client_id, template_version, rendered_clauses, rendered_text
) VALUES
  ('contract-race', 'tenant-a', 'client-race', 1, '[]', 'Race'),
  ('contract-old', 'tenant-a', 'client-replace', 1, '[]', 'Old'),
  ('contract-new', 'tenant-a', 'client-replace', 1, '[]', 'New'),
  ('contract-draft', 'tenant-a', 'client-draft', 1, '[]', 'Draft');

-- El tenant siempre es obligatorio. NULL no puede convertirse en comodín.
SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    PERFORM public.contract_sign_apply(
      NULL, 'contract-race', 'doc-null', 'null.pdf', 'tenant-a/client-race/null.pdf',
      'application/pdf', repeat('a', 64), 'witness-null', 'tecnico'
    );
    RAISE EXCEPTION 'tenant NULL aceptado';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'tenant NULL aceptado'
       OR SQLERRM NOT LIKE 'contract_sign_apply: invalid_tenant_id%' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

-- Carrera real: ambas conexiones entran; una escribe y la otra recibe la
-- primera firma con already_signed=true. El lock está en contracts/clients,
-- nunca en la evidencia (donde service_role no tiene UPDATE).
DO $$
DECLARE
  result_a JSONB;
  result_b JSONB;
  conn TEXT := 'dbname=' || current_database();
BEGIN
  PERFORM dblink_connect('contract_a', conn);
  PERFORM dblink_connect('contract_b', conn);
  PERFORM dblink_exec('contract_a', 'SET ROLE service_role');
  PERFORM dblink_exec('contract_b', 'SET ROLE service_role');
  PERFORM dblink_send_query('contract_a', $q$
    SELECT public.contract_sign_apply(
      'tenant-a', 'contract-race', 'doc-race-a', 'race-a.pdf',
      'tenant-a/client-race/doc-race-a-contract.pdf', 'application/pdf',
      repeat('a', 64), 'witness-a', 'tecnico', '192.0.2.1', 'fixture-a', NULL
    )
  $q$);
  PERFORM dblink_send_query('contract_b', $q$
    SELECT public.contract_sign_apply(
      'tenant-a', 'contract-race', 'doc-race-b', 'race-b.pdf',
      'tenant-a/client-race/doc-race-b-contract.pdf', 'application/pdf',
      repeat('b', 64), 'witness-b', 'tecnico', '192.0.2.2', 'fixture-b', NULL
    )
  $q$);
  SELECT value INTO result_a
    FROM dblink_get_result('contract_a') AS response(value JSONB);
  SELECT value INTO result_b
    FROM dblink_get_result('contract_b') AS response(value JSONB);
  PERFORM dblink_disconnect('contract_a');
  PERFORM dblink_disconnect('contract_b');

  IF ((result_a ->> 'already_signed')::BOOLEAN)::INTEGER
       + ((result_b ->> 'already_signed')::BOOLEAN)::INTEGER <> 1 THEN
    RAISE EXCEPTION 'la carrera no produjo un ganador y un already_signed: %, %', result_a, result_b;
  END IF;
  IF result_a ->> 'document_id' <> result_b ->> 'document_id'
     OR result_a ->> 'pdf_sha256' <> result_b ->> 'pdf_sha256' THEN
    RAISE EXCEPTION 'el perdedor no recibió la primera firma: %, %', result_a, result_b;
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.client_documents WHERE client_id = 'client-race') <> 1
     OR (SELECT count(*) FROM public.contract_signature_evidence WHERE contract_id = 'contract-race') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.contracts
       WHERE id = 'contract-race' AND status = 'signed'
         AND document_id IS NOT NULL AND pdf_sha256 IS NOT NULL AND signed_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'la carrera dejó escrituras duplicadas o contrato incompleto';
  END IF;
END $$;

-- Firmar uno nuevo anula el vigente dentro de la misma transacción.
SET ROLE service_role;
SELECT public.contract_sign_apply(
  'tenant-a', 'contract-old', 'doc-old', 'old.pdf',
  'tenant-a/client-replace/doc-old-contract.pdf', 'application/pdf',
  repeat('c', 64), 'witness-old', 'tecnico'
);
SELECT public.contract_sign_apply(
  'tenant-a', 'contract-new', 'doc-new', 'new.pdf',
  'tenant-a/client-replace/doc-new-contract.pdf', 'application/pdf',
  repeat('d', 64), 'witness-new', 'tecnico'
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.contracts
    WHERE id = 'contract-old' AND status = 'voided' AND voided_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.contracts
    WHERE id = 'contract-new' AND status = 'signed'
  ) OR (SELECT count(*) FROM public.contracts
        WHERE client_id = 'client-replace' AND status = 'signed') <> 1 THEN
    RAISE EXCEPTION 'reemplazar el contrato vigente no fue atómico';
  END IF;
  IF (SELECT count(*) FROM public.contract_signature_evidence
      WHERE contract_id IN ('contract-old', 'contract-new')) <> 2 THEN
    RAISE EXCEPTION 'anular el anterior destruyó su evidencia';
  END IF;
END $$;

-- Las tres acciones referenciales, observadas por separado.
DO $$
DECLARE
  failed_constraint TEXT;
BEGIN
  BEGIN
    DELETE FROM public.client_documents WHERE id = 'doc-new';
    RAISE EXCEPTION 'se borró el PDF firmado';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'contracts_document_id_fkey' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM public.contracts WHERE id = 'contract-new';
    RAISE EXCEPTION 'se borró el contrato con evidencia';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'contract_signature_evidence_contract_id_fkey' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM public.clients WHERE id = 'client-replace';
    RAISE EXCEPTION 'se borró el cliente con contrato';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'contracts_client_id_fkey' THEN RAISE; END IF;
  END;
END $$;

-- Un draft no inmoviliza: la aplicación puede quitarlo y luego borrar cliente.
DELETE FROM public.contracts WHERE id = 'contract-draft';
DELETE FROM public.clients WHERE id = 'client-draft';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.clients WHERE id = 'client-draft')
     OR EXISTS (SELECT 1 FROM public.contracts WHERE id = 'contract-draft') THEN
    RAISE EXCEPTION 'un draft inmovilizó al cliente';
  END IF;
END $$;

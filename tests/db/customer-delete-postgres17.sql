-- ====================================================================
-- Fixture: borrado de clientes contra PostgreSQL 17 real.
--
-- T1 fijó aquí la línea base de HOY. T2 la SUSTITUYE donde toca: la sección
-- que afirmaba "no existe ninguna RPC de borrado" ahora afirma lo contrario,
-- y la que reproducía el defecto vivo —arrasar el historial y luego fallar—
-- pasa a exigir que la RPC NO lo tenga.
--
-- Qué comprueba:
--   1. El grafo de claves foráneas del caso, entero y exacto (67 FK).
--   2. Lo que PostgreSQL hace por sí solo: qué bloquea, qué arrasa, qué
--      desliga. Es el contrato sobre el que se apoya la RPC.
--   3. Los privilegios EXACTOS que la migración concede, ni uno más.
--   4. Que `customers_delete_cascade` existe con la forma declarada.
--   5. La RPC ejercitada: transaccionalidad, matriz, tenant y storage_path.
-- ====================================================================

\set ON_ERROR_STOP on

-- ====================================================================
-- 1. EL GRAFO DE CLAVES FORÁNEAS
--
-- La lista de abajo es el contrato. Se compara contra pg_constraint con un
-- FULL OUTER JOIN, así que detecta las tres formas de romperlo: cambiar una
-- acción referencial, quitar una FK y añadir una que nadie declaró.
-- ====================================================================

CREATE TEMP TABLE expected_fks (child TEXT, col TEXT, parent TEXT, on_delete TEXT);

INSERT INTO expected_fks (child, col, parent, on_delete) VALUES
  -- Hacia clients ---------------------------------------------------
  -- RESTRICT: el historial financiero BLOQUEA el borrado del cliente.
  ('adjustments',               'client_id',   'clients', 'RESTRICT'),
  ('credit_notes',              'client_id',   'clients', 'RESTRICT'),
  ('payment_receipts',          'client_id',   'clients', 'RESTRICT'),
  ('payments',                  'client_id',   'clients', 'RESTRICT'),
  -- CASCADE: se van con el cliente sin decir nada.
  ('client_activity_log',       'client_id',   'clients', 'CASCADE'),
  ('client_alternate_contacts', 'client_id',   'clients', 'CASCADE'),
  ('client_documents',          'client_id',   'clients', 'CASCADE'),
  ('client_tags',               'client_id',   'clients', 'CASCADE'),
  ('client_timeline',           'client_id',   'clients', 'CASCADE'),
  ('invoices',                  'client_id',   'clients', 'CASCADE'),
  ('payment_promises',          'client_id',   'clients', 'CASCADE'),
  ('portal_user_bindings',      'client_id',   'clients', 'CASCADE'),
  ('service_subscriptions',     'client_id',   'clients', 'CASCADE'),
  ('customer_service_state',    'customer_id', 'clients', 'CASCADE'),
  ('reactivation_orders',       'customer_id', 'clients', 'CASCADE'),
  ('suspension_events',         'customer_id', 'clients', 'CASCADE'),
  ('suspension_orders',         'customer_id', 'clients', 'CASCADE'),
  -- SET NULL: el esquema quiso CONSERVARLOS y desligarlos. `remove()` los
  -- hard-borra, contradiciendo al esquema. La decisión del usuario es
  -- respetar el esquema (ver H2 en el artifact padre); T2 lo materializa.
  ('onus',                      'client_id',   'clients', 'SET NULL'),
  ('tickets',                   'client_id',   'clients', 'SET NULL'),
  ('work_orders',               'client_id',   'clients', 'SET NULL'),
  -- SET NULL que `remove()` NO recorre: hoy funcionan bien precisamente
  -- porque el código no las toca y PostgreSQL las desliga solo. La RPC tiene
  -- que preservar ese comportamiento ahora que el borrado es SQL explícito.
  ('cash_register_entries',     'client_id',   'clients', 'SET NULL'),
  ('commercial_appointments',   'client_id',   'clients', 'SET NULL'),
  ('commercial_quotes',         'client_id',   'clients', 'SET NULL'),
  ('inventory_serial_units',    'client_id',   'clients', 'SET NULL'),
  ('radius_accounting',         'client_id',   'clients', 'SET NULL'),
  ('suspension_action_logs',    'client_id',   'clients', 'SET NULL'),

  -- Hacia invoices --------------------------------------------------
  ('adjustments',               'invoice_id',  'invoices', 'RESTRICT'),
  ('credit_applications',       'invoice_id',  'invoices', 'RESTRICT'),
  ('payment_applications',      'invoice_id',  'invoices', 'RESTRICT'),
  ('credit_notes',              'invoice_id',  'invoices', 'SET NULL'),
  ('invoice_items',             'invoice_id',  'invoices', 'CASCADE'),
  ('invoice_payments',          'invoice_id',  'invoices', 'CASCADE'),

  -- Hacia payments / credit_notes / service_subscriptions -----------
  ('payment_applications',      'payment_id',     'payments',              'RESTRICT'),
  ('payment_receipts',          'payment_id',     'payments',              'RESTRICT'),
  ('credit_applications',       'credit_note_id', 'credit_notes',          'RESTRICT'),
  ('invoices',                  'subscription_id','service_subscriptions', 'SET NULL'),

  -- Hacia plans -----------------------------------------------------
  ('clients',                   'plan_id',     'plans', 'SET NULL'),
  ('service_subscriptions',     'plan_id',     'plans', 'RESTRICT'),
  ('commercial_quotes',         'plan_id',     'plans', 'SET NULL'),
  ('commercial_prospects',      'plan_id',     'plans', 'SET NULL'),

  -- Hacia commercial_prospects / work_orders ------------------------
  ('commercial_quotes',         'prospect_id',    'commercial_prospects', 'CASCADE'),
  ('commercial_appointments',   'prospect_id',    'commercial_prospects', 'SET NULL'),
  ('commercial_appointments',   'work_order_id',  'work_orders',          'SET NULL'),

  -- Hacia tenants ---------------------------------------------------
  ('client_activity_log',       'tenant_id',   'tenants', 'RESTRICT'),
  ('client_alternate_contacts', 'tenant_id',   'tenants', 'RESTRICT'),
  ('client_documents',          'tenant_id',   'tenants', 'RESTRICT'),
  ('client_tags',               'tenant_id',   'tenants', 'RESTRICT'),
  ('clients',                   'tenant_id',   'tenants', 'RESTRICT'),
  ('customer_service_state',    'tenant_id',   'tenants', 'RESTRICT'),
  ('invoices',                  'tenant_id',   'tenants', 'RESTRICT'),
  ('onus',                      'tenant_id',   'tenants', 'RESTRICT'),
  ('payment_applications',      'tenant_id',   'tenants', 'RESTRICT'),
  ('payment_promises',          'tenant_id',   'tenants', 'RESTRICT'),
  ('payments',                  'tenant_id',   'tenants', 'RESTRICT'),
  ('portal_user_bindings',      'tenant_id',   'tenants', 'RESTRICT'),
  ('reactivation_orders',       'tenant_id',   'tenants', 'RESTRICT'),
  ('suspension_events',         'tenant_id',   'tenants', 'RESTRICT'),
  ('suspension_orders',         'tenant_id',   'tenants', 'RESTRICT'),
  ('tickets',                   'tenant_id',   'tenants', 'RESTRICT'),
  ('work_orders',               'tenant_id',   'tenants', 'RESTRICT'),
  ('plans',                     'tenant_id',   'tenants', 'RESTRICT'),
  ('cash_register_entries',     'tenant_id',   'tenants', 'RESTRICT'),
  ('commercial_appointments',   'tenant_id',   'tenants', 'RESTRICT'),
  ('commercial_quotes',         'tenant_id',   'tenants', 'RESTRICT'),
  ('commercial_prospects',      'tenant_id',   'tenants', 'RESTRICT'),
  -- La única excepción del esquema: SET NULL, no RESTRICT (ola6:19).
  ('radius_accounting',         'tenant_id',   'tenants', 'SET NULL'),

  -- Hacia olts ------------------------------------------------------
  ('onus',                      'olt_id',      'olts', 'SET NULL');

CREATE TEMP VIEW actual_fks AS
SELECT
  c.conrelid::regclass::TEXT AS child,
  (
    SELECT string_agg(a.attname, ',' ORDER BY x.ord)
    FROM unnest(c.conkey) WITH ORDINALITY x(att, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.att
  ) AS col,
  c.confrelid::regclass::TEXT AS parent,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS on_delete
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE c.contype = 'f' AND n.nspname = 'public';

DO $$
DECLARE
  diff TEXT;
  n INTEGER;
BEGIN
  SELECT count(*), string_agg(msg, E'\n  ' ORDER BY msg)
  INTO n, diff
  FROM (
    SELECT CASE
             WHEN e.child IS NULL THEN
               format('FK NO DECLARADA en el fixture: %s.%s → %s (%s)', a.child, a.col, a.parent, a.on_delete)
             WHEN a.child IS NULL THEN
               format('FK AUSENTE en el esquema: %s.%s → %s (%s)', e.child, e.col, e.parent, e.on_delete)
             ELSE
               format('ACCIÓN REFERENCIAL CAMBIADA: %s.%s → %s espera %s, el esquema dice %s',
                      e.child, e.col, e.parent, e.on_delete, a.on_delete)
           END AS msg
    FROM expected_fks e
    FULL OUTER JOIN actual_fks a
      ON a.child = e.child AND a.col = e.col AND a.parent = e.parent
    WHERE e.child IS NULL OR a.child IS NULL OR a.on_delete IS DISTINCT FROM e.on_delete
  ) d;

  IF n > 0 THEN
    RAISE EXCEPTION E'el grafo de FK no coincide con la línea base (% divergencia(s)):\n  %', n, diff;
  END IF;
END $$;

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM expected_fks;
  IF n <> 67 THEN
    RAISE EXCEPTION 'la línea base debería declarar 67 FK, declara %', n;
  END IF;
  RAISE NOTICE 'grafo de FK verificado: % claves foráneas coinciden con el esquema', n;
END $$;

-- ====================================================================
-- CENSO — cuántas filas cuelgan de un cliente, tabla por tabla.
--
-- Se usa para la afirmación central del ticket: tras un borrado bloqueado,
-- el censo tiene que ser EXACTAMENTE el mismo que antes.
-- ====================================================================
CREATE FUNCTION pg_temp.fx_census(p_client TEXT) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  spec TEXT;
  t TEXT; c TEXT;
  n BIGINT;
  out JSONB := '{}'::JSONB;
  specs TEXT[] := ARRAY[
    'clients:id',
    'payments:client_id', 'payment_receipts:client_id', 'credit_notes:client_id',
    'adjustments:client_id', 'invoices:client_id', 'service_subscriptions:client_id',
    'client_documents:client_id', 'client_timeline:client_id', 'client_tags:client_id',
    'client_alternate_contacts:client_id', 'client_activity_log:client_id',
    'payment_promises:client_id', 'portal_user_bindings:client_id',
    'customer_service_state:customer_id', 'suspension_events:customer_id',
    'suspension_orders:customer_id', 'reactivation_orders:customer_id',
    'onus:client_id', 'tickets:client_id', 'work_orders:client_id',
    'cash_register_entries:client_id', 'commercial_quotes:client_id',
    'commercial_appointments:client_id', 'inventory_serial_units:client_id',
    'radius_accounting:client_id', 'suspension_action_logs:client_id',
    'invoice_items:@invoice', 'invoice_payments:@invoice',
    'payment_applications:@invoice', 'credit_applications:@invoice'
  ];
BEGIN
  FOREACH spec IN ARRAY specs LOOP
    t := split_part(spec, ':', 1);
    c := split_part(spec, ':', 2);
    IF c = '@invoice' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I x WHERE x.invoice_id IN '
        '(SELECT i.id FROM public.invoices i WHERE i.client_id = $1)', t
      ) INTO n USING p_client;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I x WHERE x.%I = $1', t, c)
        INTO n USING p_client;
    END IF;
    out := out || jsonb_build_object(t, n);
  END LOOP;
  RETURN out;
END $$;

-- ====================================================================
-- 2. LO QUE POSTGRESQL HACE POR SÍ SOLO
--
-- Es el contrato sobre el que se apoya la RPC: la función no reimplementa la
-- cascada, deja que el esquema la ejecute. Si esto cambia, la RPC cambia de
-- comportamiento sin que su código se toque.
-- ====================================================================

INSERT INTO public.clients (id, full_name, address, city, plan_id)
VALUES ('c-full', 'Cliente con historial', 'Calle 1', 'Mérida', 'plan-basic');

INSERT INTO public.service_subscriptions (id, client_id, plan_id) VALUES ('sub-1', 'c-full', 'plan-basic');
INSERT INTO public.invoices (id, client_id, client_name, amount, due_date, subscription_id, total_cents)
VALUES ('fac-1', 'c-full', 'Cliente con historial', 500.00, CURRENT_DATE, 'sub-1', 50000);
INSERT INTO public.invoice_items (id, invoice_id, description, price) VALUES ('it-1', 'fac-1', 'Mensualidad', 500.00);
INSERT INTO public.invoice_payments (id, invoice_id, amount) VALUES ('ip-1', 'fac-1', 500.00);
INSERT INTO public.payments (id, client_id, client_name, amount_cents) VALUES ('pay-1', 'c-full', 'Cliente con historial', 50000);
INSERT INTO public.payment_applications (id, payment_id, invoice_id, applied_cents) VALUES ('pa-1', 'pay-1', 'fac-1', 50000);
INSERT INTO public.payment_receipts (id, payment_id, client_id, receipt_number) VALUES ('rec-1', 'pay-1', 'c-full', 'REC-2026-001');
INSERT INTO public.credit_notes (id, client_id, client_name, invoice_id, amount_cents, reason)
VALUES ('cn-1', 'c-full', 'Cliente con historial', 'fac-1', 1000, 'Cortesía');
INSERT INTO public.credit_applications (id, credit_note_id, invoice_id, applied_cents) VALUES ('ca-1', 'cn-1', 'fac-1', 1000);
INSERT INTO public.adjustments (id, invoice_id, client_id, amount_cents, reason, created_by)
VALUES ('adj-1', 'fac-1', 'c-full', 500, 'Recargo', 'admin');

INSERT INTO public.client_documents (id, client_id, doc_type, file_name, storage_path)
VALUES ('doc-1', 'c-full', 'ine', 'ine.pdf', 'tenant-default/c-full/ine.pdf');
INSERT INTO public.client_timeline (id, client_id, event_type, summary) VALUES ('tl-1', 'c-full', 'created', 'Alta');
INSERT INTO public.client_tags (id, client_id, label) VALUES ('tag-1', 'c-full', 'vip');
INSERT INTO public.client_alternate_contacts (id, client_id, name) VALUES ('cc-1', 'c-full', 'Contacto');
INSERT INTO public.client_activity_log (id, client_id, action) VALUES ('al-1', 'c-full', 'update');
INSERT INTO public.payment_promises (id, client_id, promised_date) VALUES ('pp-1', 'c-full', CURRENT_DATE);
INSERT INTO public.portal_user_bindings (user_id, client_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'c-full');

INSERT INTO public.onus (id, client_id, client_name, olt_id) VALUES ('onu-1', 'c-full', 'Cliente con historial', 'olt-1');
INSERT INTO public.tickets (id, client_id, client_name, title, description, category)
VALUES ('tk-1', 'c-full', 'Cliente con historial', 'Sin señal', 'Reporta corte', 'soporte');
INSERT INTO public.work_orders (id, title, client_id, client_name) VALUES ('wo-1', 'Instalación', 'c-full', 'Cliente con historial');

INSERT INTO public.commercial_prospects (id, name, plan_id) VALUES ('pros-1', 'Prospecto', 'plan-basic');
INSERT INTO public.cash_register_entries (id, client_id, amount_cents) VALUES ('cre-1', 'c-full', 50000);
INSERT INTO public.commercial_quotes (id, prospect_id, client_id, plan_id, title)
VALUES ('cq-1', 'pros-1', 'c-full', 'plan-basic', 'Cotización');
INSERT INTO public.commercial_appointments (id, prospect_id, client_id, work_order_id, title, scheduled_at)
VALUES ('cap-1', 'pros-1', 'c-full', 'wo-1', 'Visita', NOW());
INSERT INTO public.inventory_serial_units (id, item_id, serial, client_id)
VALUES ('isu-1', 'inv-1', 'SN-0001', 'c-full');
INSERT INTO public.radius_accounting (id, username, client_id) VALUES ('ra-1', 'c-full@wisp', 'c-full');
INSERT INTO public.suspension_action_logs (id, client_id, client_name, action)
VALUES ('sal-1', 'c-full', 'Cliente con historial', 'suspend');

INSERT INTO public.customer_service_state (customer_id) VALUES ('c-full');
INSERT INTO public.suspension_events (id, customer_id, event_type) VALUES ('sev-1', 'c-full', 'evaluated');
INSERT INTO public.suspension_orders (id, customer_id) VALUES ('sord-1', 'c-full');
INSERT INTO public.reactivation_orders (id, customer_id) VALUES ('rord-1', 'c-full');

-- ── 2.1 El historial financiero BLOQUEA el borrado ──────────────────
DO $$
DECLARE
  sqlstate_got TEXT;
BEGIN
  BEGIN
    DELETE FROM public.clients WHERE id = 'c-full';
    RAISE EXCEPTION 'el borrado directo debería estar bloqueado por RESTRICT y no lo estuvo';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS sqlstate_got = RETURNED_SQLSTATE;
    RAISE NOTICE 'borrado directo bloqueado como se esperaba (SQLSTATE %)', sqlstate_got;
  END;
END $$;

-- ── 2.2 El modo de fallo que la RPC viene a eliminar ────────────────
-- Reproduce el orden de `remove()` a medio camino: las CASCADE ya se llevaron
-- el historial de facturación y el último DELETE sigue fallando. Sin
-- transacción —que es como corre hoy por PostgREST— eso no se deshace.
-- La sección 5.2 exige que la RPC NO tenga este modo de fallo.
DO $$
DECLARE
  invoices_left INTEGER;
  client_left INTEGER;
BEGIN
  BEGIN
    DELETE FROM public.payment_applications WHERE payment_id = 'pay-1';
    DELETE FROM public.payment_receipts WHERE payment_id = 'pay-1';
    DELETE FROM public.credit_applications WHERE credit_note_id = 'cn-1';
    DELETE FROM public.adjustments WHERE client_id = 'c-full';
    DELETE FROM public.invoices WHERE client_id = 'c-full';   -- arrasa items y pagos embebidos
    DELETE FROM public.clients WHERE id = 'c-full';
    RAISE EXCEPTION 'se esperaba que payments RESTRICT bloqueara el borrado';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;  -- capturado: la subtransacción implícita revierte el bloque
  END;

  SELECT count(*) INTO invoices_left FROM public.invoices WHERE client_id = 'c-full';
  SELECT count(*) INTO client_left FROM public.clients WHERE id = 'c-full';
  IF invoices_left <> 1 OR client_left <> 1 THEN
    RAISE EXCEPTION 'estado inesperado tras el rollback: % facturas, % clientes', invoices_left, client_left;
  END IF;
  RAISE NOTICE 'defecto de remove() reproducido: sin transacción, el historial se pierde y el cliente sobrevive';
END $$;

-- ── 2.3 Con las RESTRICT retiradas en orden, CASCADE y SET NULL ─────
DELETE FROM public.payment_applications WHERE payment_id = 'pay-1';
DELETE FROM public.payment_receipts WHERE payment_id = 'pay-1';
DELETE FROM public.credit_applications WHERE credit_note_id = 'cn-1';
DELETE FROM public.adjustments WHERE client_id = 'c-full';
DELETE FROM public.payments WHERE client_id = 'c-full';
DELETE FROM public.credit_notes WHERE client_id = 'c-full';

DELETE FROM public.clients WHERE id = 'c-full';

DO $$
DECLARE
  t TEXT;
  n INTEGER;
  cascaded TEXT[] := ARRAY[
    'invoices', 'invoice_items', 'invoice_payments', 'service_subscriptions',
    'client_documents', 'client_timeline', 'client_tags',
    'client_alternate_contacts', 'client_activity_log', 'payment_promises',
    'portal_user_bindings', 'customer_service_state', 'suspension_events',
    'suspension_orders', 'reactivation_orders'
  ];
BEGIN
  FOREACH t IN ARRAY cascaded LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'CASCADE no vació %: quedan % fila(s)', t, n;
    END IF;
  END LOOP;
  RAISE NOTICE 'CASCADE verificado sobre % tablas', array_length(cascaded, 1);
END $$;

DO $$
DECLARE
  t TEXT;
  n INTEGER;
  detached TEXT[] := ARRAY[
    'onus', 'tickets', 'work_orders', 'cash_register_entries',
    'commercial_quotes', 'commercial_appointments', 'inventory_serial_units',
    'radius_accounting', 'suspension_action_logs'
  ];
BEGIN
  FOREACH t IN ARRAY detached LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE client_id IS NULL', t) INTO n;
    IF n <> 1 THEN
      RAISE EXCEPTION '% debía sobrevivir desligada (SET NULL), n=%', t, n;
    END IF;
  END LOOP;

  SELECT count(*) INTO n FROM public.commercial_appointments
   WHERE id = 'cap-1' AND prospect_id = 'pros-1' AND work_order_id = 'wo-1';
  IF n <> 1 THEN RAISE EXCEPTION 'commercial_appointments perdió vínculos ajenos al cliente'; END IF;

  SELECT count(*) INTO n FROM public.tickets WHERE id = 'tk-1' AND client_name = 'Cliente con historial';
  IF n <> 1 THEN RAISE EXCEPTION 'tickets perdió client_name al desligarse'; END IF;

  RAISE NOTICE 'SET NULL verificado sobre % tablas, con sus vínculos ajenos intactos', array_length(detached, 1);
END $$;

-- ── 2.4 Los objetos de Storage quedan huérfanos ─────────────────────
-- El CASCADE se llevó la fila de client_documents con su storage_path, y
-- nada tocó el objeto del bucket. PL/pgSQL no puede: no habla con la Storage
-- API. Por eso la RPC devuelve los storage_path y T3 barre post-commit.
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM public.client_documents;
  IF n <> 0 THEN RAISE EXCEPTION 'client_documents debía vaciarse por CASCADE'; END IF;
  RAISE NOTICE 'la ruta del objeto se fue con la fila: sin captura previa, el bucket queda huérfano';
END $$;

-- ── 2.5 payment_applications no se alcanza desde clients ────────────
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'payment_applications'
    AND column_name IN ('client_id', 'customer_id');
  IF n <> 0 THEN
    RAISE EXCEPTION 'payment_applications ganó una columna de cliente: la línea base cambió';
  END IF;
END $$;

-- Limpieza del escenario de la sección 2: la 5 monta el suyo desde cero.
DELETE FROM public.commercial_appointments;
DELETE FROM public.commercial_quotes;
DELETE FROM public.cash_register_entries;
DELETE FROM public.inventory_serial_units;
DELETE FROM public.radius_accounting;
DELETE FROM public.suspension_action_logs;
DELETE FROM public.onus;
DELETE FROM public.tickets;
DELETE FROM public.work_orders;
DELETE FROM public.commercial_prospects;
DELETE FROM public.clients WHERE id = 'c-min';

-- ====================================================================
-- 3. PRIVILEGIOS EXACTOS
--
-- El bootstrap arranca sin ningún privilegio de tabla para service_role. Todo
-- lo que haya aquí lo concedió la migración, y tiene que ser exactamente lo
-- que declara: ni de menos (la RPC no funcionaría como SECURITY INVOKER) ni
-- de más (una cascada no comprueba privilegios, así que conceder DELETE sobre
-- las dependientes sería regalar poder que la función no usa).
-- ====================================================================
CREATE TEMP TABLE expected_grants (tbl TEXT, priv TEXT);
-- UPDATE sobre clients no es para escribir: lo exige el `SELECT … FOR UPDATE`
-- del paso 1 de la RPC. Es la única tabla que lo tiene.
INSERT INTO expected_grants (tbl, priv) VALUES
  ('clients', 'SELECT'), ('clients', 'UPDATE'), ('clients', 'DELETE');

INSERT INTO expected_grants (tbl, priv)
SELECT t, 'SELECT' FROM unnest(ARRAY[
  'payments', 'payment_receipts', 'credit_notes', 'adjustments',
  'payment_applications', 'credit_applications',
  'invoices', 'invoice_items', 'invoice_payments', 'service_subscriptions',
  'client_documents', 'client_timeline', 'client_tags',
  'client_alternate_contacts', 'client_activity_log', 'payment_promises',
  'portal_user_bindings', 'customer_service_state', 'suspension_events',
  'suspension_orders', 'reactivation_orders',
  'onus', 'tickets', 'work_orders', 'cash_register_entries',
  'commercial_quotes', 'commercial_appointments', 'inventory_serial_units',
  'radius_accounting', 'suspension_action_logs'
]) AS t;

DO $$
DECLARE
  diff TEXT;
  n INTEGER;
  all_tables TEXT[] := ARRAY[
    'clients', 'payments', 'payment_receipts', 'credit_notes', 'adjustments',
    'payment_applications', 'credit_applications',
    'invoices', 'invoice_items', 'invoice_payments', 'service_subscriptions',
    'client_documents', 'client_timeline', 'client_tags',
    'client_alternate_contacts', 'client_activity_log', 'payment_promises',
    'portal_user_bindings', 'customer_service_state', 'suspension_events',
    'suspension_orders', 'reactivation_orders',
    'onus', 'tickets', 'work_orders', 'cash_register_entries',
    'commercial_quotes', 'commercial_appointments', 'inventory_serial_units',
    'radius_accounting', 'suspension_action_logs'
  ];
BEGIN
  SELECT count(*), string_agg(msg, E'\n  ' ORDER BY msg) INTO n, diff
  FROM (
    SELECT CASE
             WHEN e.tbl IS NULL THEN format('PRIVILEGIO NO DECLARADO: service_role tiene %s sobre %s', a.priv, a.tbl)
             ELSE format('PRIVILEGIO AUSENTE: la migración debía conceder %s sobre %s', e.priv, e.tbl)
           END AS msg
    FROM expected_grants e
    FULL OUTER JOIN (
      SELECT t AS tbl, p AS priv
      FROM unnest(all_tables) AS t,
           unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
      WHERE has_table_privilege('service_role', format('public.%I', t), p)
    ) a ON a.tbl = e.tbl AND a.priv = e.priv
    WHERE e.tbl IS NULL OR a.tbl IS NULL
  ) d;

  IF n > 0 THEN
    RAISE EXCEPTION E'los privilegios de service_role no son los declarados (%):\n  %', n, diff;
  END IF;
  RAISE NOTICE 'privilegios exactos: SELECT sobre 31 tablas; UPDATE y DELETE sólo sobre clients';
END $$;

-- ====================================================================
-- 4. LA RPC EXISTE CON LA FORMA DECLARADA
--
-- Sustituye al assert de T1, que afirmaba lo contrario mientras la RPC no
-- existía.
-- ====================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid) AS result
    INTO r
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'customers_delete_cascade';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers_delete_cascade no existe: la migración no se aplicó';
  END IF;
  IF r.prosecdef THEN
    RAISE EXCEPTION 'customers_delete_cascade es SECURITY DEFINER; debe ser INVOKER';
  END IF;
  IF r.proconfig IS NULL OR NOT ('search_path=public, pg_temp' = ANY (r.proconfig)) THEN
    RAISE EXCEPTION 'customers_delete_cascade sin search_path fijo: %', r.proconfig;
  END IF;
  IF r.args <> 'p_client_id text, p_tenant_id text' THEN
    RAISE EXCEPTION 'firma inesperada: %', r.args;
  END IF;
  IF r.result <> 'jsonb' THEN
    RAISE EXCEPTION 'tipo de retorno inesperado: %', r.result;
  END IF;

  IF has_function_privilege('anon', 'public.customers_delete_cascade(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.customers_delete_cascade(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon o authenticated pueden ejecutar el borrado de clientes';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.customers_delete_cascade(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role no puede ejecutar la RPC';
  END IF;

  RAISE NOTICE 'RPC verificada: SECURITY INVOKER, search_path fijo, sólo service_role';
END $$;

-- ====================================================================
-- 5. LA RPC EJERCITADA
-- ====================================================================

-- Escenario: dos clientes en tenant-default —uno limpio, uno con historial
-- financiero— y uno en tenant-b para el aislamiento.
INSERT INTO public.clients (id, full_name, address, city, tenant_id) VALUES
  ('c-clean', 'Cliente limpio',   'Calle 3', 'Mérida', 'tenant-default'),
  ('c-block', 'Cliente con pago', 'Calle 4', 'Mérida', 'tenant-default'),
  ('c-other', 'Cliente ajeno',    'Calle 5', 'Mérida', 'tenant-b');

-- c-clean: todo lo que se borra y todo lo que se desliga, nada que bloquee.
INSERT INTO public.invoices (id, client_id, client_name, amount, due_date, total_cents)
VALUES ('fac-c1', 'c-clean', 'Cliente limpio', 100, CURRENT_DATE, 10000);
INSERT INTO public.invoice_items (id, invoice_id, description, price) VALUES ('it-c1', 'fac-c1', 'Alta', 100);
INSERT INTO public.invoice_payments (id, invoice_id, amount) VALUES ('ip-c1', 'fac-c1', 100);
INSERT INTO public.service_subscriptions (id, client_id, plan_id) VALUES ('sub-c1', 'c-clean', 'plan-basic');
INSERT INTO public.client_documents (id, client_id, doc_type, file_name, storage_path) VALUES
  ('doc-c1', 'c-clean', 'ine',     'ine.pdf',     'tenant-default/c-clean/ine.pdf'),
  ('doc-c2', 'c-clean', 'receipt', 'recibo.pdf',  'tenant-default/c-clean/recibo.pdf'),
  ('doc-c3', 'c-clean', 'other',   'sin-objeto',  NULL);   -- fila fantasma, sin ruta
INSERT INTO public.client_timeline (id, client_id, event_type, summary) VALUES ('tl-c1', 'c-clean', 'created', 'Alta');
INSERT INTO public.client_tags (id, client_id, label) VALUES ('tag-c1', 'c-clean', 'nuevo');
INSERT INTO public.client_alternate_contacts (id, client_id, name) VALUES ('cc-c1', 'c-clean', 'Contacto');
INSERT INTO public.client_activity_log (id, client_id, action) VALUES ('al-c1', 'c-clean', 'create');
INSERT INTO public.payment_promises (id, client_id, promised_date) VALUES ('pp-c1', 'c-clean', CURRENT_DATE);
INSERT INTO public.portal_user_bindings (user_id, client_id) VALUES ('22222222-2222-2222-2222-222222222222', 'c-clean');
INSERT INTO public.customer_service_state (customer_id) VALUES ('c-clean');
INSERT INTO public.suspension_events (id, customer_id, event_type) VALUES ('sev-c1', 'c-clean', 'evaluated');
INSERT INTO public.suspension_orders (id, customer_id) VALUES ('sord-c1', 'c-clean');
INSERT INTO public.reactivation_orders (id, customer_id) VALUES ('rord-c1', 'c-clean');

INSERT INTO public.olts (id, name) VALUES ('olt-2', 'OLT 2') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.commercial_prospects (id, name) VALUES ('pros-c1', 'Prospecto limpio');
INSERT INTO public.work_orders (id, title, client_id, client_name) VALUES ('wo-c1', 'Instalación', 'c-clean', 'Cliente limpio');
INSERT INTO public.onus (id, client_id, client_name, olt_id) VALUES ('onu-c1', 'c-clean', 'Cliente limpio', 'olt-2');
INSERT INTO public.tickets (id, client_id, client_name, title, description, category)
VALUES ('tk-c1', 'c-clean', 'Cliente limpio', 'Alta', 'Solicita alta', 'comercial');
INSERT INTO public.cash_register_entries (id, client_id, amount_cents) VALUES ('cre-c1', 'c-clean', 10000);
INSERT INTO public.commercial_quotes (id, prospect_id, client_id, plan_id, title)
VALUES ('cq-c1', 'pros-c1', 'c-clean', 'plan-basic', 'Cotización');
INSERT INTO public.commercial_appointments (id, prospect_id, client_id, work_order_id, title, scheduled_at)
VALUES ('cap-c1', 'pros-c1', 'c-clean', 'wo-c1', 'Visita', NOW());
INSERT INTO public.inventory_serial_units (id, item_id, serial, client_id) VALUES ('isu-c1', 'inv-1', 'SN-C1', 'c-clean');
INSERT INTO public.radius_accounting (id, username, client_id) VALUES ('ra-c1', 'c-clean@wisp', 'c-clean');
INSERT INTO public.suspension_action_logs (id, client_id, client_name, action)
VALUES ('sal-c1', 'c-clean', 'Cliente limpio', 'suspend');

-- c-block: mismo perfil, MÁS un pago con su comprobante y su aplicación.
INSERT INTO public.invoices (id, client_id, client_name, amount, due_date, total_cents)
VALUES ('fac-b1', 'c-block', 'Cliente con pago', 200, CURRENT_DATE, 20000);
INSERT INTO public.invoice_items (id, invoice_id, description, price) VALUES ('it-b1', 'fac-b1', 'Mensualidad', 200);
INSERT INTO public.client_documents (id, client_id, doc_type, file_name, storage_path)
VALUES ('doc-b1', 'c-block', 'ine', 'ine.pdf', 'tenant-default/c-block/ine.pdf');
INSERT INTO public.client_timeline (id, client_id, event_type, summary) VALUES ('tl-b1', 'c-block', 'created', 'Alta');
INSERT INTO public.client_tags (id, client_id, label) VALUES ('tag-b1', 'c-block', 'moroso');
INSERT INTO public.customer_service_state (customer_id) VALUES ('c-block');
INSERT INTO public.payments (id, client_id, client_name, amount_cents) VALUES ('pay-b1', 'c-block', 'Cliente con pago', 20000);
INSERT INTO public.payment_applications (id, payment_id, invoice_id, applied_cents) VALUES ('pa-b1', 'pay-b1', 'fac-b1', 20000);
INSERT INTO public.payment_receipts (id, payment_id, client_id, receipt_number) VALUES ('rec-b1', 'pay-b1', 'c-block', 'REC-2026-B01');
INSERT INTO public.onus (id, client_id, client_name) VALUES ('onu-b1', 'c-block', 'Cliente con pago');
INSERT INTO public.tickets (id, client_id, client_name, title, description, category)
VALUES ('tk-b1', 'c-block', 'Cliente con pago', 'Corte', 'Sin servicio', 'soporte');

-- c-other: en tenant-b, con dependencias propias.
INSERT INTO public.invoices (id, client_id, client_name, amount, due_date, total_cents, tenant_id)
VALUES ('fac-o1', 'c-other', 'Cliente ajeno', 300, CURRENT_DATE, 30000, 'tenant-b');
INSERT INTO public.client_documents (id, client_id, doc_type, file_name, storage_path, tenant_id)
VALUES ('doc-o1', 'c-other', 'ine', 'ine.pdf', 'tenant-b/c-other/ine.pdf', 'tenant-b');
INSERT INTO public.tickets (id, client_id, client_name, title, description, category, tenant_id)
VALUES ('tk-o1', 'c-other', 'Cliente ajeno', 'Consulta', 'Pregunta', 'comercial', 'tenant-b');

-- ── 5.1 Cliente sin dependencias bloqueantes: se borra entero ───────
-- Se ejecuta COMO service_role, para que los grants de la migración sean lo
-- que la sostiene. Si faltara uno, esto falla con permission denied.
SET ROLE service_role;
CREATE TEMP TABLE rpc_clean AS
  SELECT public.customers_delete_cascade('c-clean', 'tenant-default') AS r;
RESET ROLE;

DO $$
DECLARE
  res JSONB;
  t TEXT;
  n INTEGER;
  -- invoice_items e invoice_payments van aparte: cuelgan de la factura, no
  -- del cliente, y se comprueban por invoice_id más abajo.
  cascaded TEXT[] := ARRAY[
    'invoices', 'service_subscriptions',
    'client_documents', 'client_timeline', 'client_tags',
    'client_alternate_contacts', 'client_activity_log', 'payment_promises',
    'portal_user_bindings', 'customer_service_state', 'suspension_events',
    'suspension_orders', 'reactivation_orders'
  ];
  detached TEXT[] := ARRAY[
    'onus', 'tickets', 'work_orders', 'cash_register_entries',
    'commercial_quotes', 'commercial_appointments', 'inventory_serial_units',
    'radius_accounting', 'suspension_action_logs'
  ];
BEGIN
  SELECT r INTO res FROM rpc_clean;

  IF EXISTS (SELECT 1 FROM public.clients WHERE id = 'c-clean') THEN
    RAISE EXCEPTION 'c-clean debía borrarse y sigue ahí';
  END IF;

  -- Lo que declara BORRAR se fue.
  FOREACH t IN ARRAY cascaded LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ''c-clean''', t,
                   CASE WHEN t IN ('customer_service_state','suspension_events',
                                   'suspension_orders','reactivation_orders')
                        THEN 'customer_id' ELSE 'client_id' END) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'la RPC dejó % fila(s) en %', n, t; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = 'fac-c1')
     OR EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = 'fac-c1') THEN
    RAISE EXCEPTION 'la cascada de segundo nivel no llegó a invoice_items/invoice_payments';
  END IF;

  -- Lo que declara DESLIGAR sigue ahí, sin cliente.
  FOREACH t IN ARRAY detached LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE client_id IS NULL', t) INTO n;
    IF n <> 1 THEN RAISE EXCEPTION '% debía quedar desligada, n=%', t, n; END IF;
  END LOOP;

  -- …y conserva sus vínculos ajenos al cliente.
  IF NOT EXISTS (SELECT 1 FROM public.commercial_appointments
                  WHERE id = 'cap-c1' AND prospect_id = 'pros-c1' AND work_order_id = 'wo-c1') THEN
    RAISE EXCEPTION 'commercial_appointments perdió vínculos ajenos al cliente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.onus WHERE id = 'onu-c1' AND olt_id = 'olt-2') THEN
    RAISE EXCEPTION 'onus perdió su OLT al desligarse del cliente';
  END IF;

  -- El censo de auditoría refleja lo que había, no lo que quedó.
  IF (res -> 'deleted' ->> 'invoices')::INT <> 1
     OR (res -> 'deleted' ->> 'client_documents')::INT <> 3
     OR (res -> 'deleted' ->> 'suspension_orders')::INT <> 1 THEN
    RAISE EXCEPTION 'censo de borrado inesperado: %', res -> 'deleted';
  END IF;
  IF (res -> 'detached' ->> 'onus')::INT <> 1
     OR (res -> 'detached' ->> 'work_orders')::INT <> 1
     OR (res -> 'detached' ->> 'radius_accounting')::INT <> 1 THEN
    RAISE EXCEPTION 'censo de desligado inesperado: %', res -> 'detached';
  END IF;

  RAISE NOTICE 'RPC sobre cliente limpio: borrado entero, 9 tablas desligadas, censo correcto';
END $$;

-- ── 5.1b Los storage_path devueltos son EXACTAMENTE los borrados ────
-- Es lo único que T3 tendrá para barrer el bucket: si falta uno, ese objeto
-- se queda ahí para siempre; si sobra uno, T3 borraría un objeto vivo.
DO $$
DECLARE
  got TEXT[];
BEGIN
  SELECT array(SELECT jsonb_array_elements_text(r -> 'storage_paths') ORDER BY 1)
    INTO got FROM rpc_clean;

  IF got <> ARRAY['tenant-default/c-clean/ine.pdf', 'tenant-default/c-clean/recibo.pdf'] THEN
    RAISE EXCEPTION 'storage_paths inesperados: %', got;
  END IF;
  -- doc-c3 tenía storage_path NULL (fila fantasma de las que el slice viene a
  -- limpiar): no debe aparecer, no hay objeto que barrer.
  RAISE NOTICE 'storage_paths exactos: 2 rutas reales, la fila sin objeto excluida';
END $$;

-- ── 5.2 EL TEST QUE JUSTIFICA EL TICKET ─────────────────────────────
-- Cliente con una dependencia bloqueante: la RPC falla y NO SE BORRA NADA,
-- ni siquiera las tablas que se procesan antes. El censo antes y después
-- tiene que ser idéntico, tabla por tabla.
CREATE TEMP TABLE census_before AS SELECT pg_temp.fx_census('c-block') AS c;

DO $$
DECLARE
  before JSONB;
  after JSONB;
  msg TEXT;
  detail TEXT;
  divergences TEXT;
  completed BOOLEAN := FALSE;
BEGIN
  SELECT c INTO before FROM census_before;

  BEGIN
    PERFORM public.customers_delete_cascade('c-block', 'tenant-default');
    completed := TRUE;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, detail = PG_EXCEPTION_DETAIL;
    IF position('client_delete_blocked' IN msg) = 0 THEN
      RAISE EXCEPTION 'error no identificable: %', msg;
    END IF;
    IF position('baja comercial' IN lower(detail)) = 0 THEN
      RAISE EXCEPTION 'el error no orienta hacia la baja comercial: %', detail;
    END IF;
    RAISE NOTICE 'la RPC bloqueó con error identificable: %', msg;
  END;

  IF completed THEN
    RAISE EXCEPTION 'la RPC borró un cliente con historial financiero en vez de bloquear';
  END IF;

  after := pg_temp.fx_census('c-block');

  SELECT string_agg(format('%s: antes %s, después %s', k, before ->> k, after ->> k), E'\n  ' ORDER BY k)
    INTO divergences
    FROM jsonb_object_keys(before) AS k
   WHERE (before ->> k) IS DISTINCT FROM (after ->> k);

  IF divergences IS NOT NULL THEN
    RAISE EXCEPTION E'el borrado bloqueado SÍ destruyó datos:\n  %', divergences;
  END IF;

  -- Y el cliente sigue vivo, no medio borrado.
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = 'c-block') THEN
    RAISE EXCEPTION 'c-block desapareció pese a estar bloqueado';
  END IF;

  RAISE NOTICE 'borrado bloqueado: censo idéntico en las 31 tablas, nada se perdió';
END $$;

-- ── 5.3 Aislamiento por tenant ──────────────────────────────────────
DO $$
DECLARE
  msg TEXT;
  census JSONB;
  completed BOOLEAN := FALSE;
BEGIN
  census := pg_temp.fx_census('c-other');

  BEGIN
    PERFORM public.customers_delete_cascade('c-other', 'tenant-default');
    completed := TRUE;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF position('client_not_found' IN msg) = 0 THEN
      RAISE EXCEPTION 'error inesperado al cruzar tenant: %', msg;
    END IF;
  END;

  IF completed THEN
    RAISE EXCEPTION 'la RPC aceptó borrar un cliente de otro tenant';
  END IF;

  IF pg_temp.fx_census('c-other') <> census THEN
    RAISE EXCEPTION 'el cliente de otro tenant fue tocado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = 'c-other')
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = 'fac-o1')
     OR NOT EXISTS (SELECT 1 FROM public.client_documents WHERE id = 'doc-o1') THEN
    RAISE EXCEPTION 'c-other perdió filas pese a ser de otro tenant';
  END IF;

  RAISE NOTICE 'aislamiento por tenant: c-other intacto, error indistinguible de inexistente';
END $$;

-- ── 5.4 Sin tenant, la RPC sigue exigiendo que el cliente exista ────
DO $$
DECLARE
  msg TEXT;
  completed BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.customers_delete_cascade('c-inexistente', NULL);
    completed := TRUE;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF position('client_not_found' IN msg) = 0 THEN
      RAISE EXCEPTION 'error inesperado: %', msg;
    END IF;
  END;

  IF completed THEN
    RAISE EXCEPTION 'la RPC no falló con un cliente inexistente';
  END IF;
  RAISE NOTICE 'cliente inexistente: client_not_found';
END $$;

-- ── 5.5 Retirado el bloqueante, el mismo cliente se borra entero ────
-- Cierra el círculo: el bloqueo era el historial, no un defecto de la RPC.
DELETE FROM public.payment_applications WHERE payment_id = 'pay-b1';
DELETE FROM public.payment_receipts WHERE payment_id = 'pay-b1';
DELETE FROM public.payments WHERE client_id = 'c-block';

DO $$
DECLARE
  res JSONB;
BEGIN
  res := public.customers_delete_cascade('c-block', 'tenant-default');

  IF EXISTS (SELECT 1 FROM public.clients WHERE id = 'c-block') THEN
    RAISE EXCEPTION 'c-block debía borrarse una vez retirado el bloqueante';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE client_id = 'c-block') THEN
    RAISE EXCEPTION 'quedaron facturas de c-block';
  END IF;
  IF (res -> 'storage_paths') <> '["tenant-default/c-block/ine.pdf"]'::JSONB THEN
    RAISE EXCEPTION 'storage_paths de c-block inesperados: %', res -> 'storage_paths';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.onus WHERE id = 'onu-b1' AND client_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.tickets WHERE id = 'tk-b1' AND client_id IS NULL) THEN
    RAISE EXCEPTION 'onus/tickets de c-block no quedaron desligados';
  END IF;

  RAISE NOTICE 'retirado el bloqueante, el mismo cliente se borra entero';
END $$;

SELECT 'borrado transaccional de clientes verificado contra PostgreSQL 17' AS resultado;

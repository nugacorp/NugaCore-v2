-- ====================================================================
-- Fixture: LÍNEA BASE del borrado de clientes contra PostgreSQL 17 real.
--
-- Fija el comportamiento de HOY, no el deseado. T2 (RPC de borrado
-- transaccional) se contrasta contra este fichero: cualquier cambio de una
-- acción referencial tiene que aparecer aquí como una edición deliberada,
-- no como un efecto colateral.
--
-- Qué comprueba:
--   1. El grafo de claves foráneas del caso, entero y exacto (67 FK).
--      Cambiar un ON DELETE en el esquema y no aquí = fallo inmediato.
--   2. Comportamiento observado con filas reales: qué bloquea, qué arrasa y
--      qué desliga.
--   3. Que `service_role` sigue sin privilegios de tabla sobre las 31 tablas
--      del caso: la RPC de T2 tendrá que concederlos ella misma.
--
-- NO implementa ninguna RPC de borrado. Eso es T2.
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
  -- porque el código no las toca y PostgreSQL las desliga solo. T2 tiene que
  -- preservar ese comportamiento cuando el borrado pase a SQL explícito.
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
-- 2. COMPORTAMIENTO OBSERVADO CON FILAS REALES
-- ====================================================================

-- Cliente con historial completo: una fila en cada tabla del caso.
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

-- Las seis que `remove()` no recorre. Hoy nadie las limpia a mano: al borrar
-- el cliente sólo actúa el SET NULL de PostgreSQL, y eso es lo correcto.
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
-- Hoy `remove()` recibe un 23503 aquí y lo traduce a ConflictError… pero sólo
-- DESPUÉS de haber borrado las dependientes una a una y sin transacción.
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

-- ── 2.2 EL DEFECTO VIVO: arrasa primero, falla después ──────────────
-- Reproduce el orden de `remove()` a medio camino: las CASCADE ya se llevaron
-- el historial de facturación y el último DELETE sigue fallando. Sin
-- transacción —que es como corre hoy por PostgREST— eso no se deshace.
-- Aquí sí hay transacción, y por eso el ROLLBACK devuelve el estado: el
-- fixture demuestra el modo de fallo sin dejarlo escrito en la base.
DO $$
DECLARE
  invoices_left INTEGER;
  client_left INTEGER;
BEGIN
  BEGIN
    -- El orden real: primero los hijos M:N, luego las entidades RESTRICT.
    DELETE FROM public.payment_applications WHERE payment_id = 'pay-1';
    DELETE FROM public.payment_receipts WHERE payment_id = 'pay-1';
    DELETE FROM public.credit_applications WHERE credit_note_id = 'cn-1';
    DELETE FROM public.adjustments WHERE client_id = 'c-full';
    DELETE FROM public.invoices WHERE client_id = 'c-full';   -- arrasa items y pagos embebidos

    -- …y aquí `remove()` se traga un fallo: `payments` sigue siendo RESTRICT
    -- porque su DELETE falló (RLS, privilegios, lo que sea) y se registró con
    -- `warn` en vez de `throw`.
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
  RAISE NOTICE 'defecto reproducido: sin transacción, el historial se pierde y el cliente sobrevive';
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
  -- Todo esto desaparece por CASCADE, sin una sola línea de código.
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

-- Los tres que el esquema DESLIGA en vez de borrar. Éste es el assert que
-- T2 tiene que seguir cumpliendo: la ONU es un equipo físico que sigue en el
-- poste, y tickets/work_orders son historial operativo.
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM public.onus WHERE id = 'onu-1' AND client_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'onus debía sobrevivir desligada (SET NULL), n=%', n; END IF;

  SELECT count(*) INTO n FROM public.tickets WHERE id = 'tk-1' AND client_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'tickets debía sobrevivir desligado (SET NULL), n=%', n; END IF;

  SELECT count(*) INTO n FROM public.work_orders WHERE id = 'wo-1' AND client_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'work_orders debía sobrevivir desligada (SET NULL), n=%', n; END IF;

  -- Y conservan la denormalización: el nombre del cliente sigue ahí.
  SELECT count(*) INTO n FROM public.tickets WHERE id = 'tk-1' AND client_name = 'Cliente con historial';
  IF n <> 1 THEN RAISE EXCEPTION 'tickets perdió client_name al desligarse'; END IF;

  RAISE NOTICE 'SET NULL verificado: onus, tickets y work_orders sobreviven desligados';
END $$;

-- Las seis invisibles desde `remove()`. Hoy funcionan BIEN: el código no las
-- toca y el SET NULL de PostgreSQL actúa solo. Éste es el assert que impide
-- que T2, al pasar el borrado a SQL explícito, las convierta en hard-borrado
-- por olvidarse de que existen.
DO $$
DECLARE
  t TEXT;
  n INTEGER;
  untouched TEXT[] := ARRAY[
    'cash_register_entries', 'commercial_quotes', 'commercial_appointments',
    'inventory_serial_units', 'radius_accounting', 'suspension_action_logs'
  ];
BEGIN
  FOREACH t IN ARRAY untouched LOOP
    -- Sobreviven…
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 1 THEN
      RAISE EXCEPTION '% debía sobrevivir al borrado del cliente, quedan % fila(s)', t, n;
    END IF;
    -- …y quedan desligadas, no colgando de un cliente inexistente.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE client_id IS NOT NULL', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION '% conservó client_id tras el borrado: SET NULL no actuó', t;
    END IF;
  END LOOP;

  -- El resto de sus vínculos NO se toca: la cita sigue colgada de su
  -- prospecto y de su orden de trabajo, y la cotización de su plan.
  SELECT count(*) INTO n FROM public.commercial_appointments
   WHERE id = 'cap-1' AND prospect_id = 'pros-1' AND work_order_id = 'wo-1';
  IF n <> 1 THEN RAISE EXCEPTION 'commercial_appointments perdió vínculos ajenos al cliente'; END IF;

  SELECT count(*) INTO n FROM public.commercial_quotes
   WHERE id = 'cq-1' AND prospect_id = 'pros-1' AND plan_id = 'plan-basic';
  IF n <> 1 THEN RAISE EXCEPTION 'commercial_quotes perdió vínculos ajenos al cliente'; END IF;

  -- suspension_action_logs conserva el nombre denormalizado: es la única
  -- huella de a quién se suspendió.
  SELECT count(*) INTO n FROM public.suspension_action_logs
   WHERE id = 'sal-1' AND client_name = 'Cliente con historial';
  IF n <> 1 THEN RAISE EXCEPTION 'suspension_action_logs perdió la huella del cliente'; END IF;

  RAISE NOTICE 'las 6 tablas que remove() no recorre sobreviven desligadas, como hoy';
END $$;

-- ── 2.4 Los objetos de Storage quedan huérfanos ─────────────────────
-- El CASCADE se llevó la fila de client_documents con su storage_path, y
-- nada tocó el objeto del bucket. PL/pgSQL no puede: no habla con la Storage
-- API. Por eso T2 devuelve los storage_path y T3 barre después del commit
-- (ver H1 de la cuarta ronda en el artifact padre).
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM public.client_documents;
  IF n <> 0 THEN RAISE EXCEPTION 'client_documents debía vaciarse por CASCADE'; END IF;
  RAISE NOTICE 'la ruta del objeto se fue con la fila: sin captura previa, el bucket queda huérfano';
END $$;

-- ── 2.5 payment_applications no se alcanza desde clients ────────────
-- No tiene client_id ni customer_id: sólo se llega por payment_id/invoice_id,
-- y bloquea ambos con RESTRICT. Es la razón de que `remove()` empiece por ahí.
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

-- Un cliente cuya única atadura es una aplicación de pago: sigue bloqueado.
INSERT INTO public.clients (id, full_name, address, city) VALUES ('c-min', 'Mínimo', 'Calle 2', 'Mérida');
INSERT INTO public.invoices (id, client_id, client_name, amount, due_date) VALUES ('fac-2', 'c-min', 'Mínimo', 100, CURRENT_DATE);
INSERT INTO public.payments (id, client_id, client_name, amount_cents) VALUES ('pay-2', 'c-min', 'Mínimo', 10000);
INSERT INTO public.payment_applications (id, payment_id, invoice_id, applied_cents) VALUES ('pa-2', 'pay-2', 'fac-2', 10000);

DO $$
BEGIN
  BEGIN
    DELETE FROM public.invoices WHERE id = 'fac-2';
    RAISE EXCEPTION 'payment_applications debía bloquear el borrado de la factura';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'payment_applications bloquea invoices como se esperaba';
  END;
END $$;

-- ====================================================================
-- 3. PRIVILEGIOS: service_role sigue sin nada de tabla
--
-- Es la línea base contra la que T2 demostrará sus GRANT. Si esto empieza a
-- pasar por accidente, el gate de T2 dejaría de significar nada.
-- ====================================================================
DO $$
DECLARE
  t TEXT;
  p TEXT;
  targets TEXT[] := ARRAY[
    'clients', 'invoices', 'invoice_items', 'invoice_payments',
    'payments', 'payment_applications', 'payment_receipts',
    'credit_notes', 'credit_applications', 'adjustments',
    'service_subscriptions', 'client_documents', 'client_timeline',
    'client_tags', 'client_alternate_contacts', 'client_activity_log',
    'payment_promises', 'portal_user_bindings', 'onus', 'tickets',
    'work_orders', 'customer_service_state', 'suspension_events',
    'suspension_orders', 'reactivation_orders',
    -- Las seis que `remove()` no recorre
    'cash_register_entries', 'commercial_quotes', 'commercial_appointments',
    'inventory_serial_units', 'radius_accounting', 'suspension_action_logs'
  ];
BEGIN
  IF array_length(targets, 1) <> 31 THEN
    RAISE EXCEPTION 'el caso debía cubrir 31 tablas, cubre %', array_length(targets, 1);
  END IF;
  FOREACH t IN ARRAY targets LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('service_role', format('public.%I', t), p) THEN
        RAISE EXCEPTION 'service_role tiene % sobre %: la línea base de privilegios cambió', p, t;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'service_role sin privilegios de tabla sobre las 31 tablas del caso';
END $$;

-- ====================================================================
-- 4. NO HAY RPC DE BORRADO TODAVÍA
--
-- Guardarraíl de alcance: si esto empieza a fallar es que T2 aterrizó, y su
-- fixture debe sustituir a esta línea base en vez de convivir con ella.
-- ====================================================================
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname ILIKE '%delete_client%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'apareció una RPC de borrado (%): T1 fija la línea base ANTERIOR a T2', n;
  END IF;
END $$;

SELECT 'línea base del borrado de clientes fijada contra PostgreSQL 17' AS resultado;

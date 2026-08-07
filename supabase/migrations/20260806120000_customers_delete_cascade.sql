-- ====================================================================
-- T2 — Borrado de clientes en UNA transacción, con matriz explícita.
--
-- Hoy `customers/repository.ts::remove()` emula la cascada a mano: ~25
-- operaciones sueltas por PostgREST, cada una su propia transacción, y los
-- fallos se registran con `warn` en vez de `throw`. Si el DELETE final falla
-- —cosa que ocurre, porque varias financieras son RESTRICT— lo ya borrado no
-- vuelve: el cliente sobrevive con su historial destruido.
--
-- Esta función lo convierte en una transacción única: o se completa entera, o
-- no deja rastro.
--
-- NADIE LA LLAMA TODAVÍA. `remove()` sigue igual; conectarla es T3.
--
-- ── La matriz: borrar | desligar | bloquear ─────────────────────────
--
-- Criterio, decidido por el usuario: **respetar lo que declara el esquema, no
-- lo que hace `remove()`**. Las tres columnas de abajo no son una elección
-- nueva — son las acciones referenciales que el esquema ya declaraba y que el
-- código contradecía. La línea base de T1
-- (tests/db/customer-delete-postgres17.sql) las tiene fijadas una por una.
--
-- BLOQUEAR (4 directas + 3 vía facturas) — historial financiero:
--   payments · payment_receipts · credit_notes · adjustments
--   payment_applications, credit_applications, adjustments (vía invoices)
--   Hoy se esquivan borrándolas a mano ANTES del cliente. Dejan de
--   esquivarse: ver la nota "Por qué las financieras pasan a bloquear".
--
-- BORRAR (15) — se van con el cliente, por CASCADE del propio esquema:
--   invoices (+ invoice_items, invoice_payments) · service_subscriptions ·
--   client_documents · client_timeline · client_tags ·
--   client_alternate_contacts · client_activity_log · payment_promises ·
--   portal_user_bindings · customer_service_state · suspension_events ·
--   suspension_orders · reactivation_orders
--
-- DESLIGAR (9) — sobreviven con client_id en NULL, por SET NULL del esquema:
--   onus · tickets · work_orders · cash_register_entries ·
--   commercial_quotes · commercial_appointments · inventory_serial_units ·
--   radius_accounting · suspension_action_logs
--   Los tres primeros los hard-borraba `remove()` contra lo que declara el
--   esquema. Una ONU es un equipo físico que sigue en el poste; tickets y
--   órdenes son historial operativo, y de `work_orders` cuelga la evidencia.
--   Las seis restantes `remove()` ni las conocía.
--
-- ── Por qué las financieras pasan a BLOQUEAR de verdad ──────────────
--
-- Podrían seguir esquivándose: borrar pagos, comprobantes, notas de crédito y
-- ajustes antes que el cliente, como hoy. No se hace, por tres razones:
--
--   1. El `ON DELETE RESTRICT` está en el esquema a propósito. Esquivarlo en
--      SQL congelaría en una migración la contradicción que T1 destapó.
--   2. El producto YA tiene la salida correcta para un cliente con historial:
--      `client_status = 'baja'`. El propio mensaje de error de `remove()`
--      apunta ahí ("Usa Baja comercial o limpia dependencias primero").
--   3. Pagos y comprobantes son documentos con obligación de conservación.
--      Destruirlos al dar de baja a un abonado no es una limpieza, es una
--      pérdida.
--
-- CONSECUENCIA ACEPTADA: un cliente que alguna vez cobró deja de poder
-- borrarse; se le da de baja. El cambio no se nota aquí —nadie llama a esta
-- función— sino cuando T3 conecte `remove()`.
--
-- ── El segundo nivel del grafo ──────────────────────────────────────
--
-- La matriz de arriba se derivó al principio de las FK DIRECTAS a `clients`.
-- Eso dejó una fuga: la cascada no se detiene en los hijos directos, sigue por
-- los hijos de todo lo que borra. `payment_orders.invoice_id` es NO ACTION y
-- cuelga de `invoices`, que sí cascadea — así que un checkout iniciado y nunca
-- pagado hacía reventar el borrado con un 23503 crudo, y encima invisible al
-- pre-check, porque sin cobro no hay fila en `payments`.
--
-- El criterio correcto no es "las FK que apuntan a clients" sino **el cierre
-- transitivo de la cascada**: toda tabla cuyas filas acaben borradas, y toda
-- FK que apunte a cualquiera de ellas. El fixture lo calcula ahora desde
-- `pg_constraint` y exige que la matriz cubra el cierre entero, así que una
-- tabla nueva en cualquier nivel rompe el gate en vez de colarse.
--
-- PURGAR (1) — la cascada las alcanza y no se desmontan solas:
--   payment_orders. Se borra: un checkout abandonado no es historial
--   financiero. Si llegó a pagarse hay fila en `payments`, y ésa bloquea.
--
-- DESLIGAR por sentencia (1):
--   payment_events. Es el acuse del proveedor y el ledger de idempotencia de
--   20260730150000; la columna es nullable a propósito. Se conserva.
--
-- ── Bytes fuera de la transacción ───────────────────────────────────
--
-- PL/pgSQL no habla con la Storage API, así que la función NO puede borrar
-- los objetos del bucket. Devuelve los `storage_path` de los
-- `client_documents` borrados y T3 barre después del commit. Sin eso, cada
-- baja abandonaría INE y comprobantes en un bucket privado sin ninguna fila
-- que los nombre.
--
-- Idempotente: CREATE OR REPLACE y GRANT resisten la segunda aplicación que
-- hace el runner del gate.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.customers_delete_cascade(
  p_client_id TEXT,
  p_tenant_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- La matriz, como dato. 'tabla:columna', donde la columna puede ser:
  --   client_id / customer_id → se alcanza directamente desde el cliente
  --   @invoice                → se alcanza por invoice_id, vía sus facturas
  --   @both                   → por client_id O por invoice_id (adjustments)
  c_blocking TEXT[] := ARRAY[
    'payments:client_id',
    'payment_receipts:client_id',
    'credit_notes:client_id',
    'adjustments:@both',
    'payment_applications:@invoice',
    'credit_applications:@invoice'
  ];
  c_cascade TEXT[] := ARRAY[
    'invoices:client_id',
    'invoice_items:@invoice',
    'invoice_payments:@invoice',
    'service_subscriptions:client_id',
    'client_documents:client_id',
    'client_timeline:client_id',
    'client_tags:client_id',
    'client_alternate_contacts:client_id',
    'client_activity_log:client_id',
    'payment_promises:client_id',
    'portal_user_bindings:client_id',
    'customer_service_state:customer_id',
    'suspension_events:customer_id',
    'suspension_orders:customer_id',
    'reactivation_orders:customer_id'
  ];
  c_detach TEXT[] := ARRAY[
    'onus:client_id',
    'tickets:client_id',
    'work_orders:client_id',
    'cash_register_entries:client_id',
    'commercial_quotes:client_id',
    'commercial_appointments:client_id',
    'inventory_serial_units:client_id',
    'radius_accounting:client_id',
    'suspension_action_logs:client_id'
  ];
  -- Tablas que la cascada ALCANZA pero que NO se desmontan solas, porque su
  -- FK es NO ACTION. Sin tratarlas aquí el borrado revienta con un 23503
  -- crudo en el DELETE final. Ver la nota "El segundo nivel del grafo".
  c_purge TEXT[] := ARRAY['payment_orders'];

  v_spec TEXT;
  v_table TEXT;
  v_column TEXT;
  v_count BIGINT;
  v_tenant TEXT;
  v_blocked JSONB := '{}'::JSONB;
  v_deleted JSONB := '{}'::JSONB;
  v_detached JSONB := '{}'::JSONB;
  v_paths TEXT[];
  v_removed INTEGER;
BEGIN
  IF p_client_id IS NULL OR btrim(p_client_id) = '' THEN
    RAISE EXCEPTION 'customers_delete_cascade: invalid_client_id';
  END IF;

  -- ── 1. Existencia y aislamiento por tenant ───────────────────────
  -- El lock evita que otra transacción cuelgue filas del cliente entre la
  -- comprobación previa y el DELETE: sin él, una carrera se manifestaría como
  -- un 23503 crudo desde el DELETE en vez de como una espera limpia. La
  -- atomicidad no depende de esto —la función es una transacción— pero el
  -- error identificable sí.
  SELECT c.tenant_id INTO v_tenant
    FROM public.clients c
   WHERE c.id = p_client_id
     AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
     FOR UPDATE;

  IF NOT FOUND THEN
    -- Cliente inexistente y cliente de otro tenant son indistinguibles a
    -- propósito: no filtra la existencia de filas ajenas.
    RAISE EXCEPTION 'customers_delete_cascade: client_not_found: %', p_client_id;
  END IF;

  -- ── 2. Comprobación previa, ANTES de la primera sentencia destructiva ──
  -- Éste es el corazón del ticket. Hoy el bloqueo se descubre en el último
  -- DELETE, cuando lo anterior ya arrasó el historial. Aquí se descubre
  -- primero, y nada se ha tocado todavía.
  FOREACH v_spec IN ARRAY c_blocking LOOP
    v_table  := split_part(v_spec, ':', 1);
    v_column := split_part(v_spec, ':', 2);

    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    IF v_column = '@invoice' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I t WHERE t.invoice_id IN '
        '(SELECT i.id FROM public.invoices i WHERE i.client_id = $1)', v_table
      ) INTO v_count USING p_client_id;
    ELSIF v_column = '@both' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I t WHERE t.client_id = $1 OR t.invoice_id IN '
        '(SELECT i.id FROM public.invoices i WHERE i.client_id = $1)', v_table
      ) INTO v_count USING p_client_id;
    ELSE
      EXECUTE format(
        'SELECT count(*) FROM public.%I t WHERE t.%I = $1', v_table, v_column
      ) INTO v_count USING p_client_id;
    END IF;

    IF v_count > 0 THEN
      v_blocked := v_blocked || jsonb_build_object(v_table, v_count);
    END IF;
  END LOOP;

  IF v_blocked <> '{}'::JSONB THEN
    -- Error identificable: el llamador distingue "bloqueado" de cualquier
    -- otro fallo por el prefijo, y sabe QUÉ bloquea por el detalle.
    RAISE EXCEPTION 'customers_delete_cascade: client_delete_blocked: %', v_blocked::TEXT
      USING DETAIL = 'El cliente tiene historial financiero con ON DELETE RESTRICT. '
                     'Usa la baja comercial (status = baja) en vez del borrado.',
            HINT   = v_blocked::TEXT;
  END IF;

  -- ── 3. Los bytes que la transacción no alcanza ───────────────────
  -- Se capturan ANTES del DELETE: después, la fila que nombra el objeto ya
  -- no existe y la ruta se pierde para siempre.
  SELECT coalesce(array_agg(d.storage_path ORDER BY d.storage_path), ARRAY[]::TEXT[])
    INTO v_paths
    FROM public.client_documents d
   WHERE d.client_id = p_client_id
     AND d.storage_path IS NOT NULL;

  -- ── 4. Censo para auditoría, también previo al DELETE ────────────
  FOREACH v_spec IN ARRAY c_cascade LOOP
    v_table  := split_part(v_spec, ':', 1);
    v_column := split_part(v_spec, ':', 2);
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN CONTINUE; END IF;

    IF v_column = '@invoice' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I t WHERE t.invoice_id IN '
        '(SELECT i.id FROM public.invoices i WHERE i.client_id = $1)', v_table
      ) INTO v_count USING p_client_id;
    ELSE
      EXECUTE format(
        'SELECT count(*) FROM public.%I t WHERE t.%I = $1', v_table, v_column
      ) INTO v_count USING p_client_id;
    END IF;

    IF v_count > 0 THEN
      v_deleted := v_deleted || jsonb_build_object(v_table, v_count);
    END IF;
  END LOOP;

  FOREACH v_spec IN ARRAY c_detach LOOP
    v_table  := split_part(v_spec, ':', 1);
    v_column := split_part(v_spec, ':', 2);
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN CONTINUE; END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%I t WHERE t.%I = $1', v_table, v_column
    ) INTO v_count USING p_client_id;

    IF v_count > 0 THEN
      v_detached := v_detached || jsonb_build_object(v_table, v_count);
    END IF;
  END LOOP;

  -- ── 5. El segundo nivel que no se desmonta solo ──────────────────
  -- `payment_orders.invoice_id` es NO ACTION: la cascada llega hasta ahí y
  -- se estrella. Un checkout iniciado y nunca pagado NO es historial
  -- financiero —no hay cobro, comprobante ni obligación de conservación—, y
  -- si llegara a pagarse existiría una fila en `payments`, que sí bloquea.
  -- Decisión del usuario: se borra con el cliente.
  --
  -- Sus `payment_events` NO se borran: son el acuse del proveedor y el ledger
  -- de idempotencia que sostiene 20260730150000. La columna es nullable a
  -- propósito, así que el evento sobrevive desligado de la orden, igual que
  -- una ONU sobrevive desligada del abonado.
  UPDATE public.payment_events e
     SET payment_order_id = NULL
   WHERE e.payment_order_id IN (
     SELECT o.id FROM public.payment_orders o
      WHERE o.customer_id = p_client_id
         OR o.invoice_id IN (SELECT i.id FROM public.invoices i WHERE i.client_id = p_client_id)
   );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    v_detached := v_detached || jsonb_build_object('payment_events', v_count);
  END IF;

  FOREACH v_spec IN ARRAY c_purge LOOP
    v_table := split_part(v_spec, ':', 1);
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format(
      'DELETE FROM public.%I t WHERE t.customer_id = $1 OR t.invoice_id IN '
      '(SELECT i.id FROM public.invoices i WHERE i.client_id = $1)', v_table
    ) USING p_client_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      v_deleted := v_deleted || jsonb_build_object(v_table, v_count);
    END IF;
  END LOOP;

  -- ── 6. Un solo DELETE ────────────────────────────────────────────
  -- Las 15 tablas de BORRAR se van por CASCADE y las 9 de DESLIGAR quedan con
  -- client_id en NULL por SET NULL, todo dentro de esta misma sentencia. No
  -- se reimplementa a mano lo que el esquema ya declara: reimplementarlo es
  -- justo lo que produjo la divergencia que T1 destapó.
  DELETE FROM public.clients c
   WHERE c.id = p_client_id
     AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id);

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed <> 1 THEN
    -- Inalcanzable con el lock tomado; si ocurre, revertir es lo correcto.
    RAISE EXCEPTION 'customers_delete_cascade: unexpected_delete_count: %', v_removed;
  END IF;

  RETURN jsonb_build_object(
    'client_id', p_client_id,
    'tenant_id', v_tenant,
    'deleted', v_deleted,
    'detached', v_detached,
    'storage_paths', to_jsonb(v_paths)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customers_delete_cascade(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customers_delete_cascade(TEXT, TEXT)
  TO service_role;

-- SECURITY INVOKER needs real table privileges; never rely on bootstrap-wide grants.
--
-- El privilegio mínimo real es más pequeño de lo que parece: una CASCADE y un
-- SET NULL NO comprueban privilegios de tabla, así que la función no necesita
-- DELETE ni UPDATE sobre las 24 tablas dependientes — sólo SELECT para
-- contarlas, y DELETE sobre `clients`, que es la única fila que borra por
-- sentencia propia.
GRANT USAGE ON SCHEMA public TO service_role;
DO $$
DECLARE
  grant_spec TEXT;
  table_name TEXT;
  privileges TEXT;
  grants TEXT[] := ARRAY[
    -- La única tabla que la función borra por sentencia propia. UPDATE no es
    -- para escribir: `SELECT … FOR UPDATE` exige privilegio UPDATE aunque la
    -- fila nunca se modifique, igual que le pasó a `payment_applications` en
    -- 20260730150000. Se concede aquí y en ninguna otra tabla.
    'clients:SELECT, UPDATE, DELETE',
    -- Bloqueantes: se cuentan antes de tocar nada.
    'payments:SELECT',
    'payment_receipts:SELECT',
    'credit_notes:SELECT',
    'adjustments:SELECT',
    'payment_applications:SELECT',
    'credit_applications:SELECT',
    -- La cascada NO comprueba privilegios, pero estas dos SÍ se tocan por
    -- sentencia propia: `payment_orders` se borra y `payment_events` se
    -- desliga. Son los únicos DELETE/UPDATE fuera de `clients`.
    'payment_orders:SELECT, DELETE',
    'payment_events:SELECT, UPDATE',
    -- Censo de lo que se borra por CASCADE.
    'invoices:SELECT',
    'invoice_items:SELECT',
    'invoice_payments:SELECT',
    'service_subscriptions:SELECT',
    'client_documents:SELECT',
    'client_timeline:SELECT',
    'client_tags:SELECT',
    'client_alternate_contacts:SELECT',
    'client_activity_log:SELECT',
    'payment_promises:SELECT',
    'portal_user_bindings:SELECT',
    'customer_service_state:SELECT',
    'suspension_events:SELECT',
    'suspension_orders:SELECT',
    'reactivation_orders:SELECT',
    -- Censo de lo que se desliga por SET NULL.
    'onus:SELECT',
    'tickets:SELECT',
    'work_orders:SELECT',
    'cash_register_entries:SELECT',
    'commercial_quotes:SELECT',
    'commercial_appointments:SELECT',
    'inventory_serial_units:SELECT',
    'radius_accounting:SELECT',
    'suspension_action_logs:SELECT'
  ];
BEGIN
  FOREACH grant_spec IN ARRAY grants LOOP
    table_name := split_part(grant_spec, ':', 1);
    privileges := split_part(grant_spec, ':', 2);
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT %s ON TABLE public.%I TO service_role', privileges, table_name
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.customers_delete_cascade(TEXT, TEXT) IS
  'Borra un cliente en una sola transacción. Comprueba los bloqueantes ANTES '
  'de tocar nada, deja que CASCADE y SET NULL hagan lo que el esquema declara, '
  'y devuelve los storage_path de los documentos borrados para que la capa TS '
  'barra el bucket tras el commit.';

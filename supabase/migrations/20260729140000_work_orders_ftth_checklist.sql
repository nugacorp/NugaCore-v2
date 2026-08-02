-- ====================================================================
-- Checklist FTTH en órdenes de trabajo.
--
-- Una instalación de fibra requiere datos que una de radio no tiene: serie de
-- la ONU, puerto de CTO ocupado y lectura de potencia óptica. En vez de crear
-- una tabla paralela, se extiende work_orders con la tecnología y un bloque
-- JSONB de captura de campo (patrón "campos dinámicos por tecnología").
--
-- Evolutiva e idempotente: ADD COLUMN IF NOT EXISTS. Las órdenes existentes
-- quedan con technology NULL ⇒ se tratan como 'radio' y no cambian de flujo.
-- ====================================================================

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS technology TEXT
    CHECK (technology IS NULL OR technology IN ('radio', 'fiber')),
  ADD COLUMN IF NOT EXISTS ftth_data JSONB;

COMMENT ON COLUMN public.work_orders.technology IS
  'radio | fiber. NULL ⇒ radio (órdenes previas al módulo FTTH).';

COMMENT ON COLUMN public.work_orders.ftth_data IS
  'Captura de campo FTTH: onuSerial, napId, napPort, rxPowerDbm, txPowerDbm, '
  'spliceLossDb, measuredAt. El cierre de una orden fiber exige serie, NAP, '
  'puerto y potencia dentro de rango (backend/domains/tickets/ftth-checklist.ts).';

-- Órdenes de fibra pendientes: consulta habitual del despacho de cuadrillas.
CREATE INDEX IF NOT EXISTS idx_work_orders_technology
  ON public.work_orders (technology)
  WHERE technology = 'fiber';

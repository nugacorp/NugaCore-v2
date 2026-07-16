-- FTTH: tramos de fibra, hilos y continuidad NAP.
CREATE TABLE IF NOT EXISTS public.fiber_segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  from_ref TEXT,
  to_ref TEXT,
  from_label TEXT NOT NULL DEFAULT '',
  to_label TEXT NOT NULL DEFAULT '',
  segment_type TEXT NOT NULL DEFAULT 'feeder',
  thread_count INTEGER NOT NULL DEFAULT 12 CHECK (thread_count >= 1),
  coordinates JSONB NOT NULL DEFAULT '[]'::jsonb,
  nap_id TEXT REFERENCES public.nap_boxes(id) ON DELETE SET NULL,
  pon_port TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fiber_segments_nap ON public.fiber_segments (nap_id);
CREATE INDEX IF NOT EXISTS idx_fiber_segments_type ON public.fiber_segments (segment_type);

CREATE TABLE IF NOT EXISTS public.fiber_threads (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES public.fiber_segments(id) ON DELETE CASCADE,
  thread_num INTEGER NOT NULL CHECK (thread_num >= 1),
  nap_id TEXT REFERENCES public.nap_boxes(id) ON DELETE SET NULL,
  port_num INTEGER,
  status TEXT NOT NULL DEFAULT 'free',
  continues_to_nap_id TEXT REFERENCES public.nap_boxes(id) ON DELETE SET NULL,
  continues_to_thread INTEGER,
  client_label TEXT NOT NULL DEFAULT '',
  UNIQUE (segment_id, thread_num)
);

CREATE INDEX IF NOT EXISTS idx_fiber_threads_nap ON public.fiber_threads (nap_id);
CREATE INDEX IF NOT EXISTS idx_fiber_threads_segment ON public.fiber_threads (segment_id);

ALTER TABLE public.nap_ports
  ADD COLUMN IF NOT EXISTS thread_id TEXT REFERENCES public.fiber_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS continues_to_nap_id TEXT REFERENCES public.nap_boxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS continues_to_thread INTEGER;

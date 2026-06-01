// ====================================================================
// Logger centralizado.
//
// - Niveles: debug | info | warn | error (filtrables por LOG_LEVEL).
// - Formatos: "pretty" (humano, dev) o "json" (estructurado, prod).
// - API retro-compatible: logger.info/warn/error(message, meta?).
//   (se añade logger.debug y logger.child(context)).
//
// Sin dependencias externas; lee process.env directamente para evitar
// ciclos de importación con config/env.
// ====================================================================

type Meta = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const isProd = (process.env.NODE_ENV || 'development') === 'production';

const resolveMinLevel = (): Level => {
  const raw = (process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return isProd ? 'info' : 'debug';
};

const resolveFormat = (): 'pretty' | 'json' => {
  const raw = (process.env.LOG_FORMAT || '').trim().toLowerCase();
  if (raw === 'pretty' || raw === 'json') return raw;
  return isProd ? 'json' : 'pretty';
};

const MIN_LEVEL = resolveMinLevel();
const FORMAT = resolveFormat();

const sinkFor = (level: Level): ((line: string) => void) => {
  if (level === 'error') return (line) => console.error(line);
  if (level === 'warn') return (line) => console.warn(line);
  return (line) => console.log(line);
};

const emit = (level: Level, message: string, baseContext: Meta, meta?: Meta): void => {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return;

  const merged: Meta = { ...baseContext, ...(meta || {}) };
  const hasMeta = Object.keys(merged).length > 0;
  const timestamp = new Date().toISOString();

  if (FORMAT === 'json') {
    sinkFor(level)(JSON.stringify({ timestamp, level, message, ...(hasMeta ? { meta: merged } : {}) }));
    return;
  }

  const suffix = hasMeta ? ` ${JSON.stringify(merged)}` : '';
  sinkFor(level)(`[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`);
};

export interface Logger {
  debug: (message: string, meta?: Meta) => void;
  info: (message: string, meta?: Meta) => void;
  warn: (message: string, meta?: Meta) => void;
  error: (message: string, meta?: Meta) => void;
  /** Devuelve un logger que adjunta `context` a cada línea (p.ej. requestId, domain). */
  child: (context: Meta) => Logger;
}

const makeLogger = (baseContext: Meta): Logger => ({
  debug: (message, meta) => emit('debug', message, baseContext, meta),
  info: (message, meta) => emit('info', message, baseContext, meta),
  warn: (message, meta) => emit('warn', message, baseContext, meta),
  error: (message, meta) => emit('error', message, baseContext, meta),
  child: (context) => makeLogger({ ...baseContext, ...context }),
});

export const logger: Logger = makeLogger({});

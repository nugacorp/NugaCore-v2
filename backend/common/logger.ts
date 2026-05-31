type Meta = Record<string, unknown>;

function print(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: Meta): void {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${new Date().toISOString()}] [${level}] ${message}${payload}`);
}

export const logger = {
  info: (message: string, meta?: Meta) => print('INFO', message, meta),
  warn: (message: string, meta?: Meta) => print('WARN', message, meta),
  error: (message: string, meta?: Meta) => print('ERROR', message, meta),
};

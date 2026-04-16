type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function formatEntry(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (meta) Object.assign(entry, meta);
  return JSON.stringify(entry);
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('debug')) console.debug(formatEntry('debug', msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('info')) console.info(formatEntry('info', msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('warn')) console.warn(formatEntry('warn', msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('error')) console.error(formatEntry('error', msg, meta));
  },
};

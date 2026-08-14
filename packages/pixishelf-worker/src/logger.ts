import { redactSensitiveText } from '@pixishelf/job-runtime'

export type LogFields = Record<string, unknown>

export interface WorkerLogger {
  debug?(event: string, fields?: LogFields): void
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
}

export interface WritableLogStream {
  write(chunk: string): unknown
}

const sensitiveField =
  /(?:access[_-]?token|api[_-]?key|authorization|connection[_-]?string|cookie|credential|database[_-]?url|dsn|password|private[_-]?key|secret|token)/i

function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
      stack: value.stack ? redactSensitiveText(value.stack) : undefined
    }
  }
  if (typeof value === 'bigint') return value.toString(10)
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sensitiveField.test(key) ? '[REDACTED]' : normalize(nested)])
    )
  }
  return value
}

export function createJsonLogger(
  stream: WritableLogStream = process.stdout,
  now: () => Date = () => new Date()
): WorkerLogger {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', event: string, fields: LogFields = {}) => {
    stream.write(`${JSON.stringify(normalize({ timestamp: now().toISOString(), level, event, ...fields }))}\n`)
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields)
  }
}

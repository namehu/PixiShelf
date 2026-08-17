import winston from 'winston'

const isProduction = process.env.NODE_ENV === 'production'
const sensitiveField =
  /(?:access[_-]?token|api[_-]?key|authorization|connection[_-]?string|cookie|credential|database[_-]?url|dsn|password|private[_-]?key|secret|token)/i

function redactSensitiveText(value: string) {
  return (
    value
      // Authorization values can contain whitespace and comma-separated Digest parameters.
      // Redact the complete header value first so the generic key rule cannot leave credentials behind.
      .replace(
        /(\bauthorization["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:Bearer|Basic|Digest|Token)\s+[^\r\n]*)/gi,
        '$1[REDACTED]'
      )
      .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(/\b(Bearer|Basic|Digest|Token)\s+[^\s,;]+/gi, '$1 [REDACTED]')
      .replace(
        /([?&](?:access_token|accessToken|api_key|apiKey|authorization|databaseUrl|dsn|password|secret|token)=)[^&#\s]+/gi,
        '$1[REDACTED]'
      )
      .replace(
        /((?:access[_-]?token|api[_-]?key|authorization|connection[_-]?string|cookie|credential|database[_-]?url|dsn|password|private[_-]?key|secret|token)["']?\s*[:=]\s*["']?)[^\s,"';}\]]+/gi,
        '$1[REDACTED]'
      )
  )
}

export function serializeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
      stack: value.stack ? redactSensitiveText(value.stack) : undefined
    }
  }
  if (typeof value === 'bigint') return value.toString(10)
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map(serializeLogValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sensitiveField.test(key) ? '[REDACTED]' : serializeLogValue(nested)
      ])
    )
  }
  return value
}

export function formatProductionLog(info: Record<string, unknown>, service = 'pixishelf') {
  return JSON.stringify(
    serializeLogValue({
      timestamp: info.timestamp ?? new Date().toISOString(),
      level: info.level,
      service,
      message: info.message,
      ...Object.fromEntries(Object.entries(info).filter(([key]) => !['timestamp', 'level', 'message'].includes(key)))
    })
  )
}

function createConsoleTransport(service: string, handleExceptions: boolean) {
  return new winston.transports.Console({
    level: isProduction ? 'info' : 'debug',
    stderrLevels: [],
    format: isProduction
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf((info) => formatProductionLog(info, service))
        )
      : winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.colorize(),
          winston.format.printf(
            ({ timestamp, level, message, ...meta }) =>
              `${timestamp} [${level}]: ${redactSensitiveText(String(message))} ${
                Object.keys(meta).length ? JSON.stringify(serializeLogValue(meta)) : ''
              }`
          )
        ),
    handleExceptions
  })
}

function createLogger(service: string, handleExceptions = false) {
  return winston.createLogger({
    level: isProduction ? 'info' : 'debug',
    transports: [createConsoleTransport(service, handleExceptions)],
    exitOnError: false
  })
}

const logger = createLogger('pixishelf', true)

// Migration output follows the same bounded stdout path as every other production log.
// Importing this module never creates a logs directory or migration.log file.
export const migrationLogger = createLogger('pixishelf-migration')

export default logger

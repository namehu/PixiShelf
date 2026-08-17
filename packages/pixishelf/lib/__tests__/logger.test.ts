import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatProductionLog } from '../logger'

describe('application logger', () => {
  it('formats production output as one JSON object and redacts nested secrets and errors', () => {
    const output = formatProductionLog(
      {
        timestamp: '2026-08-17T00:00:00.000Z',
        level: 'error',
        message: 'request failed with Bearer top-secret-token',
        databaseUrl: 'postgresql://user:password@postgres/db',
        nested: { apiKey: 'bare-api-key' },
        error: new Error('connect postgresql://user:password@postgres/db')
      },
      'pixishelf-test'
    )

    expect(output).not.toContain('top-secret-token')
    expect(output).not.toContain('bare-api-key')
    expect(output).not.toContain('user:password')
    expect(JSON.parse(output)).toMatchObject({
      timestamp: '2026-08-17T00:00:00.000Z',
      level: 'error',
      service: 'pixishelf-test',
      message: 'request failed with Bearer [REDACTED]',
      databaseUrl: '[REDACTED]',
      nested: { apiKey: '[REDACTED]' },
      error: { name: 'Error', message: 'connect postgresql://[REDACTED]@postgres/db' }
    })
  })

  it.each([
    'Authorization: Bearer bearer-secret',
    'Authorization: Basic dXNlcjpwYXNz',
    'Authorization: Digest username="admin", realm="private", response="digest-secret"',
    'Authorization: Token token-secret'
  ])('redacts the complete authorization value in messages and error stacks: %s', (authorization) => {
    const output = formatProductionLog({
      level: 'error',
      message: `request failed; ${authorization}`,
      nested: { authorization },
      error: new Error(`upstream rejected ${authorization}`)
    })

    expect(output).not.toContain('bearer-secret')
    expect(output).not.toContain('dXNlcjpwYXNz')
    expect(output).not.toContain('digest-secret')
    expect(output).not.toContain('token-secret')
    expect(JSON.parse(output)).toMatchObject({ nested: { authorization: '[REDACTED]' } })
  })

  it('uses stdout-only console transports and has no import-time file logging', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'logger.ts'), 'utf8')
    expect(source).toContain('stderrLevels: []')
    expect(source.match(/createLogger\('pixishelf', true\)/g)).toHaveLength(1)
    expect(source).toContain("createLogger('pixishelf-migration')")
    expect(source).not.toContain('winston.transports.File')
    expect(source).not.toContain('mkdirSync')
    expect(source).not.toContain("from 'node:fs'")
  })
})

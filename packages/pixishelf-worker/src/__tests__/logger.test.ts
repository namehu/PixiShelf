import { describe, expect, it } from 'vitest'
import { createJsonLogger } from '../logger.js'

describe('worker JSON logger', () => {
  it('redacts credentials, bearer tokens, and sensitive fields recursively', () => {
    let output = ''
    const logger = createJsonLogger(
      { write: (chunk) => void (output += chunk) },
      () => new Date('2026-08-14T00:00:00Z')
    )
    const databaseUrl = 'postgresql://worker:super-secret@postgres:5432/pixishelf'

    logger.error('worker.failed', {
      error: new Error(`Could not connect to ${databaseUrl} with Bearer top-secret-token`),
      nested: { databaseUrl, accessToken: 'top-secret-token' }
    })

    expect(output).not.toContain('super-secret')
    expect(output).not.toContain('top-secret-token')
    expect(JSON.parse(output)).toMatchObject({
      event: 'worker.failed',
      nested: { databaseUrl: '[REDACTED]', accessToken: '[REDACTED]' }
    })
  })
})

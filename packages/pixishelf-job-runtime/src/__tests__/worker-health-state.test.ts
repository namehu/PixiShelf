import { describe, expect, it } from 'vitest'
import { errorMessage } from '../worker-health-state.js'

describe('worker health diagnostics', () => {
  it('redacts credentials before truncating a persisted error summary', () => {
    const message = errorMessage(
      new Error(
        'postgresql://worker:database-secret@postgres/pixishelf https://api-user:api-secret@example.test Bearer bearer-secret password=plain-secret token:"token-secret" dsn=dsn-secret apiKey=api-key-secret accessToken=access-token-secret'
      )
    )

    expect(message).not.toContain('worker:database-secret')
    expect(message).not.toContain('api-user:api-secret')
    expect(message).not.toContain('bearer-secret')
    expect(message).not.toContain('plain-secret')
    expect(message).not.toContain('token-secret')
    expect(message).not.toContain('dsn-secret')
    expect(message).not.toContain('api-key-secret')
    expect(message).not.toContain('access-token-secret')
    expect(message).toContain('[REDACTED]')
  })
})

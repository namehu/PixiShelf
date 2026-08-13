import { describe, expect, it } from 'vitest'
import { ArchiveError, toArchiveError } from '../errors'

describe('archive error classification', () => {
  it('treats ENOSPC as recoverable without a disk-space preflight', () => {
    const error = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    expect(toArchiveError(error)).toMatchObject({ code: 'STORAGE_FULL', recoverable: true, pause: false })
  })

  it('persists only a validated hostname and port as remote diagnostics', () => {
    expect(new ArchiveError('REMOTE_RESPONSE_INVALID', 'failed', { remoteHost: 'Node.Hath.Network:2333' })).toMatchObject(
      { remoteHost: 'node.hath.network:2333' }
    )
    expect(
      new ArchiveError('REMOTE_RESPONSE_INVALID', 'failed', {
        remoteHost: 'proxy-user:secret@proxy.local:7890/path?token=private'
      }).remoteHost
    ).toBeNull()
  })
})

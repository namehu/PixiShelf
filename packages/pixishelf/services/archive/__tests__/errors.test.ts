import { describe, expect, it } from 'vitest'
import { toArchiveError } from '../errors'

describe('archive error classification', () => {
  it('treats ENOSPC as recoverable without a disk-space preflight', () => {
    const error = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    expect(toArchiveError(error)).toMatchObject({ code: 'STORAGE_FULL', recoverable: true, pause: false })
  })
})

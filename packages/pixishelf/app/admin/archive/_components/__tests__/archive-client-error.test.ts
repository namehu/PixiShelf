import { describe, expect, it } from 'vitest'
import { archiveClientErrorMessage } from '../archive-client-error'

describe('archive client error messages', () => {
  it('maps known transport codes to fixed actionable copy', () => {
    expect(archiveClientErrorMessage({ data: { code: 'TOO_MANY_REQUESTS' } })).toBe('远端服务暂时限流，请稍后重试。')
  })

  it('never renders raw server paths or archive URL tokens', () => {
    const raw = 'Prisma failed at /private/data for https://e-hentai.org/g/123/private-token/'
    const message = archiveClientErrorMessage({ message: raw }, '收件队列加载失败，请稍后重试。')

    expect(message).toBe('收件队列加载失败，请稍后重试。')
    expect(message).not.toContain('/private/data')
    expect(message).not.toContain('private-token')
  })
})

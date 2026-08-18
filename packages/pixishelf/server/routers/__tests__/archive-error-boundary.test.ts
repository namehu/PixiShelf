import { TRPCError } from '@trpc/server'
import { describe, expect, it, vi } from 'vitest'
import { ArchiveError } from '@/services/archive/errors'
import { runArchiveOperation } from '../archive'

vi.mock('@/lib/logger', () => ({
  default: { error: vi.fn() }
}))

describe('archive router error boundary', () => {
  it('preserves safe domain validation messages', async () => {
    const promise = runArchiveOperation(async () => {
      throw new ArchiveError('INVALID_URL', '作品链接格式无效')
    })

    await expect(promise).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '作品链接格式无效'
    } satisfies Partial<TRPCError>)
  })

  it.each([
    new ArchiveError('INTERNAL', 'database failed at /private/archive/token'),
    new Error('Prisma failed for https://e-hentai.org/g/123/private-token/')
  ])('replaces internal details with a fixed client message', async (error) => {
    const promise = runArchiveOperation(async () => {
      throw error
    })

    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '归档服务暂时不可用，请稍后重试'
    } satisfies Partial<TRPCError>)
  })
})

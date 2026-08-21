import { TRPCError } from '@trpc/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }))

import { sourceAuditErrorToTrpcError } from '../source-audit'

describe('source audit router error boundary', () => {
  it('does not expose unknown Prisma errors or absolute paths', () => {
    const error = sourceAuditErrorToTrpcError(new Error('Prisma failed at /secret/media/root'))
    expect(error).toBeInstanceOf(TRPCError)
    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'Source audit request failed' })
    expect(error.message).not.toContain('Prisma')
    expect(error.message).not.toContain('/secret')
  })
})

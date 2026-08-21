import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  start: vi.fn(),
  startApply: vi.fn(),
  getApplyOverview: vi.fn(),
  getApplyOperation: vi.fn(),
  get: vi.fn(),
  listItems: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }))
vi.mock('@/services/source-audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/source-audit')>()),
  getSourceAuditAvailability: mocks.availability,
  startSourceAudit: mocks.start,
  startSourceAuditApply: mocks.startApply,
  getSourceAuditApplyOverview: mocks.getApplyOverview,
  getSourceAuditApplyOperation: mocks.getApplyOperation,
  getSourceAudit: mocks.get,
  listSourceAuditItems: mocks.listItems
}))

import { sourceAuditRouter } from '../source-audit'

const authorized = {
  session: { id: 'session-1' },
  user: { id: 'admin-1' },
  userId: 'admin-1',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never

describe('source audit authorization and input boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['availability', () => sourceAuditRouter.createCaller(unauthorized).availability(), mocks.availability],
    ['get', () => sourceAuditRouter.createCaller(unauthorized).get({ auditRunId: 'audit-run-1' }), mocks.get],
    [
      'listItems',
      () => sourceAuditRouter.createCaller(unauthorized).listItems({ auditRunId: 'audit-run-1' }),
      mocks.listItems
    ],
    [
      'start',
      () => sourceAuditRouter.createCaller(unauthorized).start({ requestId: 'dfcd4234-58b5-4f01-971b-5e0efa060986' }),
      mocks.start
    ],
    [
      'startApply',
      () =>
        sourceAuditRouter.createCaller(unauthorized).startApply({
          auditRunId: 'audit-run-1',
          itemIds: ['item-1'],
          idempotencyKey: 'dfcd4234-58b5-4f01-971b-5e0efa060986'
        }),
      mocks.startApply
    ],
    [
      'getApplyOverview',
      () => sourceAuditRouter.createCaller(unauthorized).getApplyOverview({ auditRunId: 'audit-run-1' }),
      mocks.getApplyOverview
    ],
    [
      'getApplyOperation',
      () => sourceAuditRouter.createCaller(unauthorized).getApplyOperation({ operationId: 'apply-run-1' }),
      mocks.getApplyOperation
    ]
  ])('rejects unauthenticated %s before calling its service', async (_name, invoke, service) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(service).not.toHaveBeenCalled()
  })

  it.each([
    [
      'get absolute path',
      () =>
        sourceAuditRouter
          .createCaller(authorized)
          .get({ auditRunId: 'audit-run-1', absolutePath: '/secret/root' } as never),
      mocks.get
    ],
    [
      'list hash',
      () =>
        sourceAuditRouter
          .createCaller(authorized)
          .listItems({ auditRunId: 'audit-run-1', contentHash: 'a'.repeat(64) } as never),
      mocks.listItems
    ],
    [
      'start path',
      () =>
        sourceAuditRouter.createCaller(authorized).start({
          requestId: 'dfcd4234-58b5-4f01-971b-5e0efa060986',
          scanRoot: '/secret/root'
        } as never),
      mocks.start
    ],
    [
      'apply frozen evidence',
      () =>
        sourceAuditRouter.createCaller(authorized).startApply({
          auditRunId: 'audit-run-1',
          itemIds: ['item-1'],
          idempotencyKey: 'dfcd4234-58b5-4f01-971b-5e0efa060986',
          contentHash: 'a'.repeat(64)
        } as never),
      mocks.startApply
    ],
    [
      'apply operation path',
      () =>
        sourceAuditRouter
          .createCaller(authorized)
          .getApplyOperation({ operationId: 'apply-run-1', absolutePath: '/secret/root' } as never),
      mocks.getApplyOperation
    ]
  ])('strictly rejects extra %s fields before calling its service', async (_name, invoke, service) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(service).not.toHaveBeenCalled()
  })
})

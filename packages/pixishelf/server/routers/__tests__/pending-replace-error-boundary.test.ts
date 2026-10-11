import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
const mocks = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: () => true } }))
vi.mock('@/services/setting.service', () => ({ getScanPath: vi.fn() }))
vi.mock('@/services/pending-replace-service', () => ({
  createPendingReplacePreview: mocks.preview,
  bindPendingReplaceItem: vi.fn(),
  cancelPendingReplaceBatch: vi.fn(),
  cleanupPendingReplaceBatchBackups: vi.fn(),
  getPendingReplaceBatch: vi.fn(),
  recoverInterruptedPendingReplaceBatchById: vi.fn(),
  reorderPendingReplaceItem: vi.fn(),
  restorePendingReplaceItemById: vi.fn(),
  startPendingReplaceBatch: vi.fn(),
  unbindPendingReplaceItem: vi.fn()
}))
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { pendingReplaceRouter } from '../pending-replace'
const invoke = () =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    router: pendingReplaceRouter,
    req: new Request('http://localhost/api/trpc/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    }),
    createContext: () => ({ session: { id: 'session' }, user: { id: 'owner' }, headers: new Headers() }) as never
  })
describe('pending replacement error transport', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each([
    'database password=synthetic-secret',
    'not found password=synthetic-secret',
    '无法读取 Cookie: session=synthetic-secret'
  ])('hides unexpected errors even when they contain domain keywords', async (message) => {
    mocks.preview.mockRejectedValue(new Error(message))
    const response = await invoke()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('synthetic-secret')
  })
  it('preserves a known conflict message and status', async () => {
    mocks.preview.mockRejectedValue(new Error('Pending replacement job already in progress'))
    const response = await invoke()
    expect(response.status).toBe(409)
    expect((await response.json()).error.message).toBe('Pending replacement job already in progress')
  })
  it.each(['An active pending replacement has different frozen input', 'A pending replacement job is already active'])(
    'preserves typed active conflict: %s',
    async (message) => {
      mocks.preview.mockRejectedValue(new BackgroundTaskError('ACTIVE_JOB_CONFLICT', message))
      const response = await invoke()
      expect(response.status).toBe(409)
      expect((await response.json()).error.message).toBe(message)
    }
  )
  it('preserves the safe duplicate-binding explanation without directory names', async () => {
    mocks.preview.mockRejectedValue(new Error('该作品已绑定其他目录，请先解除配对'))
    const response = await invoke()
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toBe('该作品已绑定其他目录，请先解除配对')
  })
})

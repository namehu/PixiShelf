import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), add: vi.fn(), remove: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: () => true } }))
vi.mock('@/services/user-service', () => ({ addUser: mocks.add, deleteUser: mocks.remove, queryUsers: mocks.query }))
import { userRouter } from '../user'
import { createTRPCContext } from '../../context'

const operations = [
  { path: 'queryUsers', method: 'GET', input: undefined, service: mocks.query },
  {
    path: 'addUser',
    method: 'POST',
    input: { username: 'fixture-user', password: 'fixture-password' },
    service: mocks.add
  },
  { path: 'deleteUser', method: 'POST', input: 'other-user', service: mocks.remove }
]
function invoke(operation: (typeof operations)[number]) {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    router: userRouter,
    req: new Request(`http://localhost/api/trpc/${operation.path}`, {
      method: operation.method,
      headers: {
        'content-type': 'application/json',
        cookie: 'better-auth.session_token=invalid',
        'x-user-session': '{"userId":"forged"}'
      },
      ...(operation.method === 'POST' ? { body: JSON.stringify(operation.input) } : {})
    }),
    createContext: () => createTRPCContext({ headers: new Headers({ cookie: 'better-auth.session_token=invalid' }) })
  })
}
describe('user administration HTTP tRPC boundary', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each(operations)('$path rejects invalid sessions before business I/O', async (operation) => {
    for (const identity of [null, { session: { id: 'expired' } }, { session: {}, user: {} }]) {
      mocks.getSession.mockResolvedValue(identity)
      expect((await invoke(operation)).status).toBe(401)
    }
    for (const op of operations) expect(op.service).not.toHaveBeenCalled()
  })
  it.each(operations)(
    '$path hides provider and authorized business errors over the real adapter',
    async (operation) => {
      mocks.getSession.mockRejectedValue(new Error('password=synthetic-provider-secret'))
      let response = await invoke(operation)
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('synthetic-provider-secret')
      expect(operation.service).not.toHaveBeenCalled()
      mocks.getSession.mockResolvedValue({ session: { id: 'valid' }, user: { id: 'owner' } })
      operation.service.mockRejectedValue(new Error('password=synthetic-business-secret'))
      response = await invoke(operation)
      expect(operation.service).toHaveBeenCalledOnce()
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('Internal Server Error')
      expect(JSON.stringify(body)).not.toContain('synthetic-business-secret')
      expect(body.error.data.stack).toBeUndefined()
    }
  )
  it('preserves the explicit self-deletion business error', async () => {
    mocks.getSession.mockResolvedValue({ session: { id: 'valid' }, user: { id: 'other-user' } })
    const response = await invoke(operations[2]!)
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toBe('Cannot delete yourself')
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})

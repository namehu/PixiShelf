import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ initializeAdmin: vi.fn(), cookies: vi.fn(), setCookie: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/services/init-admin-service', () => ({
  initializeAdmin: mocks.initializeAdmin,
  AlreadyInitializedError: class extends Error {}
}))

import { AlreadyInitializedError } from '@/services/init-admin-service'
import { initAdminAction } from '../init-action'

describe('initial administrator Action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookies.mockResolvedValue({ set: mocks.setCookie })
  })

  it('sets the Better Auth cookie only after initialization has committed', async () => {
    let complete!: (value: { headers: Headers }) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.initializeAdmin.mockImplementation(() => {
      started()
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    const pending = initAdminAction({ username: 'first', password: 'password123' })
    await ready
    expect(mocks.cookies).not.toHaveBeenCalled()
    complete({
      headers: new Headers({
        'set-cookie': 'session=value%2Bsignature; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800'
      })
    })
    expect((await pending)?.data).toEqual({ success: true })
    expect(mocks.setCookie).toHaveBeenCalledWith('session', 'value+signature', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 604800,
      domain: undefined
    })
  })

  it.each([
    [new AlreadyInitializedError(), '系统已完成初始化，请登录'],
    [new Error('database connection details'), '创建管理员失败']
  ])('does not issue cookies on rejection or rollback', async (error, expected) => {
    if (error instanceof AlreadyInitializedError) error.message = '系统已完成初始化，请登录'
    mocks.initializeAdmin.mockRejectedValue(error)
    expect((await initAdminAction({ username: 'second', password: 'password123' }))?.data).toEqual({
      success: false,
      error: expected
    })
    expect(mocks.cookies).not.toHaveBeenCalled()
    expect(mocks.setCookie).not.toHaveBeenCalled()
  })
})

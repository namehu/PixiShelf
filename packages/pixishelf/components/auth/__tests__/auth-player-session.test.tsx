import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth, useAuthStore } from '../auth-provider'
import { useWebpPlayerStore as cache } from '@/store/use-webp-player-store'

const { push, signOut } = vi.hoisted(() => ({ push: vi.fn(), signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/lib/auth/client', () => ({ authClient: { useSession: () => ({ data: null }), signOut } }))
function SignOut() {
  const { logout } = useAuth()
  return <button onClick={() => void logout()}>退出</button>
}
beforeEach(() => {
  cache.getState().reset()
  useAuthStore.getState().setUser(null)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0123456789abcdef' }) }))
  signOut.mockImplementation(async ({ fetchOptions }: { fetchOptions: { onSuccess: () => void } }) =>
    fetchOptions.onSuccess()
  )
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().setUser(null)
  cache.getState().reset()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
describe('authentication and player session cache', () => {
  it('preserves the same account cache through provider remounts and clears it on account change', async () => {
    cache.getState().setSessionOwner('alice')
    await cache.getState().loadManifest()
    const first = render(
      <AuthProvider initialUser={{ id: 'alice' }}>
        <span>first page</span>
      </AuthProvider>
    )
    await cache.getState().loadManifest()
    first.unmount()
    const second = render(
      <AuthProvider initialUser={{ id: 'alice' }}>
        <span>second page</span>
      </AuthProvider>
    )
    await cache.getState().loadManifest()
    expect(fetch).toHaveBeenCalledTimes(1)
    second.rerender(
      <AuthProvider initialUser={{ id: 'bob' }}>
        <span>other account</span>
      </AuthProvider>
    )
    expect(cache.getState()).toMatchObject({ ownerId: 'bob', manifest: null })
  })
  it('clears the cached manifest when signing out', async () => {
    render(
      <AuthProvider initialUser={{ id: 'alice' }}>
        <SignOut />
      </AuthProvider>
    )
    await cache.getState().loadManifest()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '退出' }))
    })
    expect(cache.getState()).toMatchObject({ ownerId: null, manifest: null, pending: null })
    expect(push).toHaveBeenCalled()
  })
})

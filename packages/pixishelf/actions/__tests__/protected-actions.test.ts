import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SERVER_ERROR_MESSAGE } from 'next-safe-action'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getNoSeriesArtworkExternalIds: vi.fn(),
  rebuildTagArtworkCounts: vi.fn(),
  toggleLike: vi.fn(),
  updateProfile: vi.fn(),
  updateSettings: vi.fn(),
  createArtworks: vi.fn(),
  registerImages: vi.fn(),
  changePassword: vi.fn(),
  revalidate: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn()
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession, changePassword: mocks.changePassword } } }))
vi.mock('@/lib/logger', () => ({ default: { error: mocks.loggerError, info: mocks.loggerInfo } }))
vi.mock('@/services/artwork-service', () => ({
  getNoSeriesArtworkExternalIds: mocks.getNoSeriesArtworkExternalIds
}))
vi.mock('@/services/tag-count-service', () => ({ rebuildTagArtworkCounts: mocks.rebuildTagArtworkCounts }))

vi.mock('@/services/like-service', () => ({ toggleLike: mocks.toggleLike }))
vi.mock('@/services/user-setting-service', () => ({
  updateUserProfile: mocks.updateProfile,
  upsertUserSettings: mocks.updateSettings
}))
vi.mock('@/services/batch-import-service', () => ({
  batchCreateArtworksService: mocks.createArtworks,
  batchRegisterImagesService: mocks.registerImages
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/rate-limit-server', () => ({ checkRateLimit: async () => true }))
import { toggleLikeAction } from '../like-action'
import { updateProfileAction, updateUserSettingAction } from '../user-setting-action'
import { batchCreateArtworksAction, batchRegisterImagesAction } from '../batch-import-action'
import { changePasswordAction } from '../auth-action'

import { exportNoSeriesArtworksAction } from '../artwork-action'
import { updateTagStatsAction } from '../tag-action'

describe('protected maintenance actions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.headers.mockResolvedValue(new Headers({ 'x-user-session': '{"userId":"forged-admin"}' }))
  })

  it('rejects an unauthenticated artwork export before reading artworks', async () => {
    mocks.getSession.mockResolvedValue(null)

    const result = await exportNoSeriesArtworksAction()

    expect(result?.serverError).toBe(DEFAULT_SERVER_ERROR_MESSAGE)
    expect(mocks.getNoSeriesArtworkExternalIds).not.toHaveBeenCalled()
  })

  it('returns the export result for an authenticated account', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mocks.getNoSeriesArtworkExternalIds.mockResolvedValue(['100', '200'])

    const result = await exportNoSeriesArtworksAction()

    expect(result?.data).toEqual({ success: true, data: ['100', '200'] })
  })

  it('rejects an unauthenticated tag rebuild before writing counts', async () => {
    mocks.getSession.mockResolvedValue(null)

    const result = await updateTagStatsAction()

    expect(result?.serverError).toBe(DEFAULT_SERVER_ERROR_MESSAGE)
    expect(mocks.rebuildTagArtworkCounts).not.toHaveBeenCalled()
  })

  it('returns the rebuild result for an authenticated account', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mocks.rebuildTagArtworkCounts.mockResolvedValue({ updatedTags: 3 })

    const result = await updateTagStatsAction()

    expect(result?.data).toMatchObject({ success: true, updatedTags: 3 })
  })

  it.each([
    { name: 'artwork export', invoke: () => exportNoSeriesArtworksAction() },
    { name: 'tag rebuild', invoke: () => updateTagStatsAction() }
  ])('fails closed and hides session-provider errors for $name', async ({ invoke }) => {
    mocks.getSession.mockRejectedValue(new Error('postgres://secret-password@private-host'))
    const result = await invoke()
    expect(result?.serverError).toBe(DEFAULT_SERVER_ERROR_MESSAGE)
    expect(mocks.getNoSeriesArtworkExternalIds).not.toHaveBeenCalled()
    expect(mocks.rebuildTagArtworkCounts).not.toHaveBeenCalled()
  })
})

const writes = [
  { name: 'like', invoke: () => toggleLikeAction({ artworkId: 1, expectedUserId: 'owner' }), service: mocks.toggleLike },
  { name: 'profile', invoke: () => updateProfileAction({ name: 'Reader' }), service: mocks.updateProfile },
  {
    name: 'preferences',
    invoke: () => updateUserSettingAction({ settings: [{ key: 'artwork_display_mode', value: 'card' }] }),
    service: mocks.updateSettings
  },
  {
    name: 'batch artworks',
    invoke: () => batchCreateArtworksAction({ artworks: [{ tempId: 'one', title: 'Fixture', artistId: 1 }] }),
    service: mocks.createArtworks
  },
  {
    name: 'batch images',
    invoke: () => batchRegisterImagesAction({ items: [{ artworkId: 1, images: [{ path: 'fixture.png', size: 1 }] }] }),
    service: mocks.registerImages
  },
  {
    name: 'password',
    invoke: () => changePasswordAction({ currentPassword: 'old-password', newPassword: 'new-password' }),
    service: mocks.changePassword
  }
]

describe('protected account and import actions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.headers.mockResolvedValue(
      new Headers({ cookie: 'better-auth.session_token=forged', 'x-user-session': '{"userId":"forged"}' })
    )
  })
  it('rejects stale like actions and derives their owner from the session', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    expect((await toggleLikeAction({ artworkId: 1, expectedUserId: 'previous-user' }))?.serverError).toContain('账户已切换')
    expect(mocks.toggleLike).not.toHaveBeenCalled()
    mocks.toggleLike.mockResolvedValue(true)
    expect((await toggleLikeAction({ artworkId: 1, expectedUserId: 'owner' }))?.data).toBe(true)
    expect(mocks.toggleLike).toHaveBeenCalledExactlyOnceWith('owner', 1)
  })
  it.each(writes)('$name rejects absent, invalid and unavailable sessions without effects', async ({ invoke }) => {
    for (const identity of [null, {}, { user: {} }]) {
      mocks.getSession.mockResolvedValue(identity)
      expect((await invoke())?.serverError).toBe(DEFAULT_SERVER_ERROR_MESSAGE)
    }
    mocks.getSession.mockRejectedValue(new Error('password=synthetic-session-secret'))
    expect((await invoke())?.serverError).toBe(DEFAULT_SERVER_ERROR_MESSAGE)
    for (const { service } of writes) expect(service).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each(writes)('$name runs only after a valid session and masks business failures', async ({ invoke, service }) => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    service.mockRejectedValue(new Error('password=synthetic-business-secret'))
    const result = await invoke()
    expect(service).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('synthetic-business-secret')
    expect(result?.serverError || result?.validationErrors).toBeTruthy()
  })
  it.each([
    { invoke: () => exportNoSeriesArtworksAction(), service: mocks.getNoSeriesArtworkExternalIds },
    { invoke: () => updateTagStatsAction(), service: mocks.rebuildTagArtworkCounts }
  ])('masks an authenticated maintenance failure', async ({ invoke, service }) => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    service.mockRejectedValue(new Error('password=synthetic-maintenance-secret'))
    const result = await invoke()
    expect(service).toHaveBeenCalledOnce()
    expect(result?.data?.success).toBe(false)
    expect(JSON.stringify(result)).not.toContain('synthetic-maintenance-secret')
  })
})

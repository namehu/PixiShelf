import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SERVER_ERROR_MESSAGE } from 'next-safe-action'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getNoSeriesArtworkExternalIds: vi.fn(),
  rebuildTagArtworkCounts: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn()
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/logger', () => ({ default: { error: mocks.loggerError, info: mocks.loggerInfo } }))
vi.mock('@/services/artwork-service', () => ({
  getNoSeriesArtworkExternalIds: mocks.getNoSeriesArtworkExternalIds
}))
vi.mock('@/services/tag-count-service', () => ({ rebuildTagArtworkCounts: mocks.rebuildTagArtworkCounts }))

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

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(new Headers())
  })

  it('rejects an unauthenticated artwork export before reading artworks', async () => {
    mocks.getSession.mockResolvedValue(null)

    const result = await exportNoSeriesArtworksAction()

    expect(result?.serverError).toBeTruthy()
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

    expect(result?.serverError).toBeTruthy()
    expect(mocks.rebuildTagArtworkCounts).not.toHaveBeenCalled()
  })

  it('returns the rebuild result for an authenticated account', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mocks.rebuildTagArtworkCounts.mockResolvedValue({ updatedTags: 3 })

    const result = await updateTagStatsAction()

    expect(result?.data).toMatchObject({ success: true, updatedTags: 3 })
  })
})

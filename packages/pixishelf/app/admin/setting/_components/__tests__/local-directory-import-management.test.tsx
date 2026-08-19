import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  previewQuery: {
    data: undefined as unknown,
    isFetching: false,
    refetch: vi.fn()
  },
  statusQuery: {
    data: undefined as unknown,
    refetch: vi.fn()
  },
  mutation: {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false
  }
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey?: string[] }) =>
    options.queryKey?.[0] === 'localImport.status' ? mocks.statusQuery : mocks.previewQuery,
  useMutation: () => mocks.mutation
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    localImport: {
      preview: { queryOptions: () => ({ queryKey: ['localImport.preview'] }) },
      status: { queryOptions: () => ({ queryKey: ['localImport.status'] }) },
      saveMappings: { mutationOptions: () => ({}) },
      start: { mutationOptions: () => ({}) },
      cancel: { mutationOptions: () => ({}) }
    }
  }),
  useTRPCClient: () => ({
    artist: {
      queryPage: { query: vi.fn() },
      create: { mutate: vi.fn() }
    }
  })
}))

import LocalDirectoryImportManagement from '../local-directory-import-management'

describe('LocalDirectoryImportManagement', () => {
  beforeEach(() => {
    mocks.previewQuery.data = undefined
    mocks.statusQuery.data = {
      job: {
        status: 'COMPLETED',
        progress: 100,
        message: 'Scan completed',
        error: null,
        result: {
          scanRunId: 'run-local-import',
          total: 3,
          succeeded: 2,
          skipped: 1,
          failed: 0,
          newImages: 5
        },
        scanRun: {
          totalArtworks: 3,
          succeededArtworks: 2,
          skippedArtworks: 1,
          failedArtworks: 0,
          newImages: 5,
          durationMs: 2400,
          errorMessage: null
        }
      },
      activity: { scan: null, localImport: null }
    }
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders completed worker local import counters and scan run duration', () => {
    render(<LocalDirectoryImportManagement />)

    const successStat = screen.getByText('导入成功').parentElement
    const durationStat = screen.getByText('耗时').parentElement

    expect(successStat).toBeTruthy()
    expect(durationStat).toBeTruthy()
    expect(within(successStat!).getByText('2')).toBeTruthy()
    expect(within(durationStat!).getByText('2s')).toBeTruthy()
    expect(screen.queryByText('NaNs')).toBeNull()
  })
})

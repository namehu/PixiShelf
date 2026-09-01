import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveDownloadConcurrencySetting } from '../archive-download-concurrency-setting'

const state = vi.hoisted(() => ({
  data: {
    mediaConcurrency: 2,
    canUpdate: true,
    blockingSystemJobId: null as string | null,
    blockingArchiveImportId: null as string | null
  }
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    setting: {
      getArchiveDownloadSettings: {
        queryOptions: () => ({ queryKey: ['setting', 'getArchiveDownloadSettings'] }),
        queryKey: () => ['setting', 'getArchiveDownloadSettings']
      },
      updateArchiveDownloadSettings: {
        mutationOptions: (options: unknown) => options
      }
    }
  })
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: vi.fn() }),
  useQuery: () => ({ data: state.data, isLoading: false, refetch: vi.fn() }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() })
}))

afterEach(() => {
  cleanup()
  state.data = {
    mediaConcurrency: 2,
    canUpdate: true,
    blockingSystemJobId: null,
    blockingArchiveImportId: null
  }
})

describe('ArchiveDownloadConcurrencySetting', () => {
  it('keeps an unchanged setting unsaveable and explains when changes take effect', () => {
    render(<ArchiveDownloadConcurrencySetting />)

    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/只影响之后启动、恢复或重试/)).toBeTruthy()
  })

  it('locks saving and links to the archive import that is currently executing', () => {
    state.data = {
      mediaConcurrency: 4,
      canUpdate: false,
      blockingSystemJobId: 'job-running',
      blockingArchiveImportId: 'archive-running'
    }

    render(<ArchiveDownloadConcurrencySetting />)

    expect(screen.getByText('正在执行的归档任务锁定了此设置')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('link', { name: '查看阻塞任务' }).getAttribute('href')).toBe(
      '/admin/archive?taskId=archive-running'
    )
  })
})

import type { ArtworkDedupRunDto } from '@pixishelf/job-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateCheckPage } from '../duplicate-check-page'
import { DuplicateRunStatus } from '../duplicate-run-status'

const mocks = vi.hoisted(() => ({
  userId: 'user-a',
  getRun: vi.fn(),
  getArtist: vi.fn(),
  start: vi.fn(),
  control: vi.fn(),
  replace: vi.fn()
}))
vi.mock('../duplicate-workspace', () => ({
  DuplicateWorkspace: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('@/lib/auth/client', () => ({ useSession: () => ({ data: { user: { id: mocks.userId } }, isPending: false }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/lib/trpc', () => {
  const trpc = {
    artworkDedup: {
      getRun: {
        queryOptions: (input: unknown) => ({ queryKey: ['artwork-dedup', input], queryFn: () => mocks.getRun(input) })
      },
      start: { mutationOptions: () => ({ mutationFn: mocks.start }) },
      control: { mutationOptions: () => ({ mutationFn: mocks.control }) }
    },
    artist: {
      getById: { queryOptions: (id: number) => ({ queryKey: ['artist', id], queryFn: () => mocks.getArtist(id) }) }
    }
  }
  return { useTRPC: () => trpc }
})

function createRun(overrides: Partial<ArtworkDedupRunDto> = {}): ArtworkDedupRunDto {
  return {
    runId: 'run-1',
    artistId: 7,
    artistName: '青山',
    jobId: 'job-1',
    version: 3,
    executionVersion: 1,
    status: 'RUNNING',
    stage: 'STAT',
    mode: 'INCREMENTAL',
    includesContainment: true,
    visualStatus: 'NOT_REQUESTED',
    visualIncompleteReasons: [],
    frozenAt: '2026-10-23T00:00:00.000Z',
    startedAt: '2026-10-23T00:00:01.000Z',
    finishedAt: null,
    counts: {
      artworks: 10,
      processedArtworks: 4,
      completeArtworks: 4,
      changedArtworks: 0,
      failedArtworks: 0,
      skippedArtworks: 0,
      groups: 0,
      duplicateArtworks: 0,
      statMedia: 40,
      hashedMedia: 0,
      cacheHitMedia: 0,
      readBytes: '0'
    },
    allowedControls: ['pause', 'cancel'],
    failure: null,
    lastCompletedRun: null,
    ...overrides
  }
}

let queryClient: QueryClient
function mountPage(runId: string | null = null) {
  const renderPage = () => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <DuplicateCheckPage artistId={7} runId={runId} />
      </QueryClientProvider>
    </StrictMode>
  )
  const view = render(renderPage())
  return { ...view, refresh: () => view.rerender(renderPage()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userId = 'user-a'
  mocks.getRun.mockReset().mockResolvedValue(null)
  mocks.getArtist.mockReset().mockResolvedValue({ id: 7, name: '青山', artworksCount: 10 })
  mocks.start.mockReset().mockResolvedValue(createRun())
  mocks.control.mockReset().mockResolvedValue(createRun({ status: 'PAUSING', version: 4, allowedControls: ['cancel'] }))
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.unstubAllGlobals()
})

describe('duplicate check page', () => {
  it('starts the chosen mode once on rapid clicks and keeps the returned run in the URL', async () => {
    let resolveStart!: (run: ArtworkDedupRunDto) => void
    mocks.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )
    mountPage()
    await screen.findByText('找出重复的作品')
    fireEvent.click(screen.getByRole('button', { name: '检查选项' }))
    fireEvent.click(screen.getByRole('radio', { name: '逐一重查' }))
    fireEvent.keyDown(screen.getByRole('radio', { name: '逐一重查' }), { key: 'Escape' })
    const start = screen.getByRole('button', { name: '开始检查' })
    fireEvent.click(start)
    fireEvent.click(start)
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
    expect(mocks.start.mock.calls[0]![0]).toMatchObject({
      artistId: 7,
      expectedUserId: 'user-a',
      mode: 'FULL',
      idempotencyKey: expect.any(String)
    })
    await act(async () => resolveStart(createRun({ mode: 'FULL' })))
    await screen.findByText('正在核对作品')
    expect(screen.queryByRole('button', { name: '重新检查' })).toBeNull()
    expect(screen.queryByRole('button', { name: '开始检查' })).toBeNull()
    expect(mocks.replace).toHaveBeenCalledWith('/admin/duplicates?artistId=7&runId=run-1', { scroll: false })
  })

  it('keeps suspected-version checking optional and sends only an explicit opt-in', async () => {
    mountPage()
    await screen.findByText('找出重复的作品')
    fireEvent.click(screen.getByRole('button', { name: '检查选项' }))
    const option = screen.getByRole('checkbox', { name: '检查疑似版本' })
    expect(option.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(option)
    fireEvent.keyDown(option, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }))
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
    expect(mocks.start.mock.calls[0]![0]).toMatchObject({ includeSuspectedVersions: true, expectedUserId: 'user-a' })
  })
  it('explains a bounded incomplete visual check while keeping exact results available', () => {
    render(
      <DuplicateRunStatus
        run={createRun({
          status: 'COMPLETED',
          visualStatus: 'INCOMPLETE',
          visualIncompleteReasons: ['VISUAL_FILE_BUDGET'],
          allowedControls: []
        })}
        pending={null}
        disabled={false}
        onControl={() => {}}
      />
    )
    expect(screen.getByText(/超过本次 10,000 张静态图片上限/)).toBeTruthy()
    expect(screen.getByText(/精确和包含结果仍可核对/)).toBeTruthy()
    expect(screen.queryByText('没有找到重复作品')).toBeNull()
  })
  it('loads a persisted run and waits for server confirmation before exposing resume', async () => {
    mocks.getRun.mockResolvedValue(createRun())
    mountPage('run-1')
    await screen.findByText('正在核对作品')
    expect(mocks.getRun).toHaveBeenCalledWith({ runId: 'run-1', expectedUserId: 'user-a' })
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await screen.findByText('正在暂停检查')
    expect(screen.queryByRole('button', { name: '继续检查' })).toBeNull()
    expect(mocks.control.mock.calls[0]![0]).toMatchObject({
      runId: 'run-1',
      expectedUserId: 'user-a',
      expectedVersion: 3,
      action: 'pause'
    })
    mocks.getRun.mockResolvedValue(createRun({ status: 'PAUSED', version: 5, allowedControls: ['resume', 'cancel'] }))
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['artwork-dedup'] })
    })
    await screen.findByText('检查已暂停')
    mocks.control.mockResolvedValue(createRun({ status: 'PENDING', version: 6 }))
    fireEvent.click(screen.getByRole('button', { name: '继续检查' }))
    await screen.findByText('等待开始检查')
    expect(mocks.control.mock.calls[1]![0]).toMatchObject({ expectedVersion: 5, action: 'resume' })
  })

  it.each(['run-1', 'run-2'])('keeps the queried %s when a late control response arrives', async (currentRunId) => {
    let resolveControl!: (run: ArtworkDedupRunDto) => void
    mocks.getRun.mockResolvedValue(createRun())
    mocks.control.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveControl = resolve
        })
    )
    mountPage()
    fireEvent.click(await screen.findByRole('button', { name: '暂停' }))
    await waitFor(() => expect(mocks.control).toHaveBeenCalledTimes(1))
    const currentVersion = currentRunId === 'run-1' ? 5 : 1
    const current = createRun({
      runId: currentRunId,
      status: 'PAUSED',
      version: currentVersion,
      allowedControls: ['resume']
    })
    mocks.getRun.mockResolvedValue(current)
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['artwork-dedup'] })
    })
    await screen.findByText('检查已暂停')
    await act(async () => resolveControl(createRun({ status: 'PAUSING', version: 4, allowedControls: ['cancel'] })))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '继续检查' }) as HTMLButtonElement).disabled).toBe(false)
    )
    expect(queryClient.getQueryData(['artwork-dedup', { artistId: 7, expectedUserId: 'user-a' }])).toMatchObject({
      runId: currentRunId,
      version: currentVersion,
      status: 'PAUSED',
      allowedControls: ['resume']
    })
    expect(screen.queryByText('正在暂停检查')).toBeNull()
    mocks.control.mockResolvedValue(createRun({ runId: currentRunId, status: 'PENDING', version: currentVersion + 1 }))
    fireEvent.click(screen.getByRole('button', { name: '继续检查' }))
    await waitFor(() => expect(mocks.control).toHaveBeenCalledTimes(2))
    expect(mocks.control.mock.calls[1]![0]).toMatchObject({
      runId: currentRunId,
      expectedVersion: currentVersion,
      action: 'resume'
    })
  })

  it.each([false, true])('accepts a new run without reverting a later queried run (%s)', async (queryMovedAhead) => {
    let resolveStart!: (run: ArtworkDedupRunDto) => void
    mocks.getRun.mockResolvedValue(createRun({ status: 'COMPLETED', version: 9, allowedControls: [] }))
    mocks.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )
    mountPage()
    const restart = await screen.findByRole('button', { name: '重新检查' })
    expect(screen.getAllByRole('button', { name: '重新检查' })).toHaveLength(1)
    expect(restart.closest('header')).toBeTruthy()
    fireEvent.click(restart)
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
    if (queryMovedAhead) {
      mocks.getRun.mockResolvedValue(
        createRun({ runId: 'run-3', status: 'PAUSED', version: 1, allowedControls: ['resume'] })
      )
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ['artwork-dedup'] })
      })
      await screen.findByText('检查已暂停')
    }
    await act(async () => resolveStart(createRun({ runId: 'run-2', version: 1 })))
    const acceptedRunId = queryMovedAhead ? 'run-3' : 'run-2'
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(`/admin/duplicates?artistId=7&runId=${acceptedRunId}`, {
        scroll: false
      })
    )
    expect(queryClient.getQueryData(['artwork-dedup', { artistId: 7, expectedUserId: 'user-a' }])).toMatchObject({
      runId: acceptedRunId,
      version: 1
    })
    expect(screen.getByText(queryMovedAhead ? '检查已暂停' : '正在核对作品')).toBeTruthy()
  })

  it('uses fallback UUIDs once and keeps the key for an unconfirmed retry', async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(7)
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })
    let rejectStart!: (error: Error) => void
    mocks.start
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectStart = reject
          })
      )
      .mockResolvedValue(createRun())
    mountPage()
    const start = await screen.findByRole('button', { name: '开始检查' })
    fireEvent.click(start)
    fireEvent.click(start)
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
    const key = mocks.start.mock.calls[0]![0].idempotencyKey
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(getRandomValues).toHaveBeenCalledTimes(1)
    await act(async () => rejectStart(new Error('unconfirmed response')))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '开始检查' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }))
    await screen.findByText('正在核对作品')
    expect(mocks.start).toHaveBeenCalledTimes(2)
    expect(mocks.start.mock.calls[1]![0].idempotencyKey).toBe(key)
    expect(getRandomValues).toHaveBeenCalledTimes(1)
  })

  it('releases the submission lock when UUID preparation throws', async () => {
    const getRandomValues = vi
      .fn((bytes: Uint8Array) => {
        bytes.fill(3)
        return bytes
      })
      .mockImplementationOnce(() => {
        throw new Error('unavailable random source')
      })
    vi.stubGlobal('crypto', { getRandomValues })
    mountPage()
    fireEvent.click(await screen.findByRole('button', { name: '开始检查' }))
    await screen.findByText('操作尚未确认')
    expect(mocks.start).not.toHaveBeenCalled()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '开始检查' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }))
    await screen.findByText('正在核对作品')
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(getRandomValues).toHaveBeenCalledTimes(2)
  })

  it('sends cancellation through the versioned domain control and displays cancelling', async () => {
    mocks.getRun.mockResolvedValue(createRun())
    mocks.control.mockResolvedValue(createRun({ status: 'CANCELLING', version: 4, allowedControls: [] }))
    mountPage('run-1')
    await screen.findByText('正在核对作品')
    fireEvent.keyDown(screen.getByRole('button', { name: '更多检查操作' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '取消检查' }))
    await screen.findByText('正在取消检查')
    expect(mocks.control.mock.calls[0]![0]).toMatchObject({ runId: 'run-1', expectedVersion: 3, action: 'cancel' })
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
  })

  it('uses only allowed server controls and real processed counts', async () => {
    mocks.getRun.mockResolvedValue(createRun({ allowedControls: [] }))
    mountPage()
    await screen.findByText('正在核对作品')
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
    expect(screen.queryByRole('button', { name: '更多检查操作' })).toBeNull()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40')
    expect(mocks.getRun).toHaveBeenCalledWith({ artistId: 7, expectedUserId: 'user-a' })
  })

  it('replays an unconfirmed start with the same idempotency key and hides raw errors', async () => {
    mocks.start.mockRejectedValueOnce(new Error('/private/media/secret.png')).mockResolvedValue(createRun())
    mountPage()
    fireEvent.click(await screen.findByRole('button', { name: '开始检查' }))
    await screen.findByText('操作尚未确认')
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '开始检查' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }))
    await screen.findByText('正在核对作品')
    expect(mocks.start.mock.calls[0]![0].idempotencyKey).toBe(mocks.start.mock.calls[1]![0].idempotencyKey)
    expect(screen.queryByText('/private/media/secret.png')).toBeNull()
  })

  it('drops old account intent and late responses when the account changes', async () => {
    let resolveStart!: (run: ArtworkDedupRunDto) => void
    mocks.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )
    const page = mountPage()
    await screen.findByText('找出重复的作品')
    fireEvent.click(screen.getByRole('button', { name: '检查选项' }))
    fireEvent.click(screen.getByRole('radio', { name: '逐一重查' }))
    fireEvent.keyDown(screen.getByRole('radio', { name: '逐一重查' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }))
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
    mocks.userId = 'user-b'
    page.refresh()
    await screen.findByText('找出重复的作品')
    expect(mocks.getRun).toHaveBeenCalledWith({ artistId: 7, expectedUserId: 'user-b' })
    fireEvent.click(screen.getByRole('button', { name: '检查选项' }))
    expect(screen.getByRole('radio', { name: '快速检查' }).getAttribute('aria-checked')).toBe('true')
    await act(async () => resolveStart(createRun({ artistName: '旧账户响应' })))
    expect(screen.queryByText('旧账户响应')).toBeNull()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(['artwork-dedup', { artistId: 7, expectedUserId: 'user-a' }])).toBeUndefined()
  })

  it('keeps the last result on network failure and locks stale controls until refresh succeeds', async () => {
    mocks.getRun.mockResolvedValue(createRun())
    mountPage()
    await screen.findByText('正在核对作品')
    mocks.getRun.mockRejectedValue(new Error('private failure'))
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['artwork-dedup'] })
    })
    await screen.findByText('检查状态暂未同步')
    expect(screen.getByText('正在核对作品')).toBeTruthy()
    expect((screen.getByRole('button', { name: '暂停' }) as HTMLButtonElement).disabled).toBe(true)
    mocks.getRun.mockResolvedValue(createRun({ status: 'PAUSED', allowedControls: ['resume'] }))
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    await screen.findByText('检查已暂停')
    expect((screen.getByRole('button', { name: '继续检查' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a safe failure and retries the original run and version', async () => {
    mocks.getRun.mockResolvedValue(
      createRun({
        status: 'FAILED',
        allowedControls: ['retry'],
        failure: { code: 'SOURCE_UNAVAILABLE', message: '媒体目录暂时无法读取。' }
      })
    )
    mocks.control.mockResolvedValue(createRun({ status: 'PENDING', version: 4 }))
    mountPage('run-1')
    await screen.findByText('检查中断')
    expect(screen.getByText('媒体目录暂时无法读取。')).toBeTruthy()
    expect(screen.queryByText('SOURCE_UNAVAILABLE')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '检查详情' }))
    expect(screen.getByText('SOURCE_UNAVAILABLE')).toBeTruthy()
    fireEvent.keyDown(screen.getByText('SOURCE_UNAVAILABLE'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '重试检查' }))
    await screen.findByText('等待开始检查')
    expect(mocks.control.mock.calls[0]![0]).toMatchObject({ runId: 'run-1', expectedVersion: 3, action: 'retry' })
  })

  it('does not offer start when an artist has no works', async () => {
    mocks.getArtist.mockResolvedValue({ id: 7, name: '青山', artworksCount: 0 })
    mountPage()
    await screen.findByText('没有可检查的作品')
    expect(screen.queryByRole('button', { name: '开始检查' })).toBeNull()
  })

  it('does not turn partial completion into a claim that no duplicates exist', () => {
    const run = createRun({ status: 'COMPLETED', allowedControls: [] })
    run.counts = { ...run.counts, failedArtworks: 2, processedArtworks: 10 }
    render(<DuplicateRunStatus run={run} pending={null} disabled={false} onControl={vi.fn()} />)
    expect(screen.getByText('检查完成，有未检查项')).toBeTruthy()
    expect(screen.queryByText('没有找到重复作品')).toBeNull()
    expect(screen.getByText('2 部作品未完成检查，重新检查后再处理。')).toBeTruthy()
  })

  it('labels the containment stage and keeps completed result wording broad enough for containment', () => {
    const view = render(
      <DuplicateRunStatus run={createRun({ stage: 'MATCH' })} pending={null} disabled={false} onControl={vi.fn()} />
    )
    expect(screen.getByText('正在检查包含关系')).toBeTruthy()
    const run = createRun({ status: 'COMPLETED', allowedControls: [] })
    run.counts.groups = 2
    view.rerender(<DuplicateRunStatus run={run} pending={null} disabled={false} onControl={vi.fn()} />)
    expect(screen.getByText('找到 2 组待处理作品')).toBeTruthy()
    expect(screen.queryByText(/组内容相同的作品/)).toBeNull()
    expect(screen.queryByText(/此记录只检查了完全相同/)).toBeNull()
  })

  it('makes the scope of an older exact-only scan explicit', () => {
    render(
      <DuplicateRunStatus
        run={createRun({ status: 'COMPLETED', includesContainment: false, allowedControls: [] })}
        pending={null}
        disabled={false}
        onControl={vi.fn()}
      />
    )
    expect(screen.getByText('此记录只检查了完全相同的作品，重新检查可查完整包含')).toBeTruthy()
  })

  it.each([
    ['COMPLETED', '没有找到重复作品'],
    ['CANCELLED', '检查已取消'],
    ['PAUSED', '检查已暂停']
  ] as const)('distinguishes %s from an in-progress run', (status, label) => {
    render(
      <DuplicateRunStatus
        run={createRun({ status, allowedControls: [] })}
        pending={null}
        disabled={false}
        onControl={vi.fn()}
      />
    )
    expect(screen.getByText(label)).toBeTruthy()
  })
})

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoPlaybackManagerProvider, VideoPlaybackEntry, VideoPlaybackBatchButton } from '../video-playback'
const mocks = vi.hoisted(() => ({
  data: [] as unknown[],
  generate: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  cancel: vi.fn(),
  refetch: vi.fn()
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.data, refetch: mocks.refetch }) }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({ videoPlayback: { statuses: { queryOptions: vi.fn() } } }),
  useTRPCClient: () => ({
    videoPlayback: {
      generate: { mutate: mocks.generate },
      retry: { mutate: mocks.retry },
      remove: { mutate: mocks.remove },
      cancel: { mutate: mocks.cancel }
    }
  })
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.data = []
  mocks.generate.mockResolvedValue([{ imageId: 7, error: null }])
})
afterEach(cleanup)
const mount = () =>
  render(
    <VideoPlaybackManagerProvider imageIds={[7, 8]}>
      <VideoPlaybackEntry imageId={7} />
      <VideoPlaybackBatchButton imageIds={[7, 8]} />
    </VideoPlaybackManagerProvider>
  )
describe('playback management controls', () => {
  it('submits the selected videos independently of MP4 optimization', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '生成播放副本 (2)' }))
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith({ imageIds: [7, 8] }))
    expect(mocks.refetch).toHaveBeenCalled()
  })
  it('displays failure and retries the exact previous task', async () => {
    mocks.data = [
      { imageId: 7, copy: null, job: { id: 'failed', status: 'FAILED', progress: 12, message: '暂不支持 HDR' } }
    ]
    mount()
    expect(screen.getByText('暂不支持 HDR')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试副本' }))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith({ jobId: 'failed' }))
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('cancels active work and prevents cleaning an in-flight copy', async () => {
    mocks.data = [
      {
        imageId: 7,
        copy: { outputSize: 2048 },
        job: { id: 'active', status: 'RUNNING', progress: 37, message: '编码' }
      }
    ]
    mount()
    expect(screen.getByText(/37%/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '清理播放副本，保留原片' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '取消播放副本生成' }))
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ jobId: 'active' }))
  })
  it('cleans only the published copy by media identity', async () => {
    mocks.data = [{ imageId: 7, copy: { outputSize: 2048 }, job: null }]
    mount()
    expect(screen.getByText(/播放副本 ·/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清理播放副本，保留原片' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ imageId: 7 }))
  })
})

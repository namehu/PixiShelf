import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArchiveCoverageFooter } from '../archive-coverage-footer'
const { state, mutate, refresh } = vi.hoisted(() => ({
  state: { data: {} as Record<string, unknown> },
  mutate: vi.fn(),
  refresh: vi.fn()
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archive: {
      getCoverage: { queryOptions: () => ({}) },
      completeArtwork: { mutationOptions: (value: unknown) => value }
    }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: state.data, refetch: vi.fn() }),
  useMutation: () => ({ mutate, isPending: false })
}))
const initial = {
  revisionId: 'base',
  localCount: 20,
  sourceTotal: 200,
  partial: true,
  canComplete: true,
  active: false,
  taskId: null,
  intakeItemId: null,
  error: null
}
function show() {
  render(
    <ArchiveCoverageFooter
      artworkId={7}
      initial={initial}
      sourceLinks={[{ id: 'source', href: '/api/artworks/7/source/source', label: 'E-Hentai' } as never]}
    />
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  state.data = { ...initial }
})
afterEach(cleanup)
it('uses the protected source link and submits an explicit expected revision', () => {
  show()
  const link = screen.getByRole('link', { name: '去原站预览' })
  expect(link.getAttribute('href')).toBe('/api/artworks/7/source/source')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(screen.getByText('本地 20 / 原站 200 张')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '下载剩余图片' }))
  expect(mutate).toHaveBeenCalledWith({ artworkId: 7, expectedRevisionId: 'base', idempotencyKey: expect.any(String) })
})
it('shows a running task without allowing another completion', () => {
  state.data = { ...initial, active: true, canComplete: false, taskId: 'task' }
  show()
  expect((screen.getByRole('button', { name: '正在补全' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('link', { name: '查看补全任务' }).getAttribute('href')).toBe('/admin/archive?taskId=task')
})
it('asks for a refreshed local page after a new revision is published', () => {
  state.data = { ...initial, revisionId: 'full', partial: false, canComplete: false, localCount: 200 }
  show()
  expect(screen.getByText('本地 200 / 原站 200 张')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '刷新查看全部' }))
  expect(refresh).toHaveBeenCalledOnce()
  expect(mutate).not.toHaveBeenCalled()
})

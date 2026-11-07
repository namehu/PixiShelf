import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import tasksPage from '../page'

const redirect = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(href)
  })
)
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('../_components/maintenance-card', () => ({ MaintenanceCard: () => null }))

afterEach(() => {
  cleanup()
  redirect.mockClear()
})

it.each([
  ['direct', '?entry=direct'],
  ['privacy', '?entry=privacy'],
  [undefined, '']
] as const)('redirects the old MP4 shortcut with entry %s', async (entry, query) => {
  const path = `/admin/tasks/video-streaming-optimization${query}`
  await expect(tasksPage({ searchParams: Promise.resolve({ task: 'video-streaming', entry }) })).rejects.toThrow(path)
  expect(redirect).toHaveBeenCalledExactlyOnceWith(path)
})

it.each([
  { task: 'video-streaming', jobId: 'existing-job', entry: 'direct' },
  { task: 'image-animation' },
  { jobId: 'existing-job' }
])('keeps other task links and job detail links on the tasks page (%j)', async (params) => {
  render(await tasksPage({ searchParams: Promise.resolve(params) }))
  expect(screen.getByRole('heading', { name: '后台任务' })).toBeTruthy()
  expect(redirect).not.toHaveBeenCalled()
})

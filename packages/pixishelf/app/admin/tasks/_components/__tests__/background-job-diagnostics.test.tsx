import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobDto } from '@pixishelf/job-contracts'
import { BackgroundJobDiagnostics } from '../background-job-diagnostics'

const mocks = vi.hoisted(() => ({
  reports: {} as Record<string, unknown>,
  details: {} as Record<string, unknown>,
  refetch: vi.fn(),
  inputs: [] as Array<Record<string, unknown>>,
  copy: vi.fn(),
  error: vi.fn()
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    job: {
      backgroundDiagnosticReports: { queryOptions: (input: unknown) => ({ queryKey: ['reports', input] }) },
      backgroundDiagnosticItems: { queryOptions: (input: unknown) => ({ queryKey: ['items', input] }) }
    }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, Record<string, unknown>] }) => {
    if (queryKey[0] === 'items') mocks.inputs.push(queryKey[1])
    return {
      data: queryKey[0] === 'reports' ? mocks.reports : mocks.details,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: mocks.refetch
    }
  }
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.error } }))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ as: Tag = 'span', children, ...props }: any) => (
    <Tag data-private="true" {...props}>
      {children}
    </Tag>
  )
}))

const date = '2026-09-16T06:18:42.000Z'
const summary = {
  id: 'report',
  attempt: 1,
  source: 'SNAPSHOT',
  outcome: 'FAILED',
  itemCount: 13,
  currentCount: 10,
  inheritedCount: 3,
  complete: true,
  createdAt: date,
  closedAt: date,
  expiresAt: date,
  expired: false
}
const item = {
  id: '1',
  origin: 'CURRENT',
  targetLabel: '第 1 张 · 001.jpg',
  stage: 'MEDIA_STREAM',
  code: 'REMOTE_RESPONSE_INVALID',
  reasonKey: 'errno:ECONNRESET',
  message: '连接被重置',
  suggestion: '检查代理或网络后重试',
  evidence: [{ code: 'ECONNRESET' }],
  remoteHost: 'example.com:443',
  httpStatus: null,
  createdAt: date,
  itemAttempt: 3,
  href: null
}
const job = { id: 'job', status: 'FAILED', attempt: 1, error: '部分失败', errorCode: 'PRECONDITION_FAILED' } as JobDto

describe('failure diagnosis panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.inputs = []
    mocks.reports = {
      items: [summary],
      nextCursor: null,
      businessHref: '/admin/archive?taskId=archive',
      failedChildren: 0,
      childItems: [],
      nextChildCursor: null
    }
    mocks.details = {
      summary,
      groups: [{ reasonKey: 'errno:ECONNRESET', count: 13 }],
      items: [item],
      taskError: null,
      nextCursor: '50'
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.copy.mockResolvedValue(undefined) }
    })
  })
  afterEach(cleanup)
  it('shows objects, failure stage, technical evidence and separate advice', () => {
    render(<BackgroundJobDiagnostics job={job} />)
    expect(screen.getByText('第 1 张 · 001.jpg')).toBeTruthy()
    expect(screen.getByText('连接被重置')).toBeTruthy()
    expect(screen.getByText(/本次记录 10 · 前次遗留 3/)).toBeTruthy()
    expect(screen.getByText('下载媒体')).toBeTruthy()
    expect(screen.getByText('建议：检查代理或网络后重试')).toBeTruthy()
    expect(screen.getByText('第 1 张 · 001.jpg').getAttribute('data-private')).toBe('true')
    expect(screen.getByRole('link', { name: /业务详情/ }).getAttribute('href')).toBe('/admin/archive?taskId=archive')
  })
  it('copies only the selected diagnostic and pages without loading the entire report', async () => {
    render(<BackgroundJobDiagnostics job={job} />)
    fireEvent.click(screen.getByRole('button', { name: /复制此项诊断/ }))
    expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(mocks.inputs.at(-1)).toMatchObject({ jobId: 'job', reportId: 'report', cursor: '50', limit: 50 })
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(mocks.inputs.at(-1)?.cursor).toBeUndefined()
  })
  it('labels completed partial failures without offering new retry actions', () => {
    mocks.details = { ...mocks.details, summary: { ...summary, outcome: 'COMPLETED' } }
    render(<BackgroundJobDiagnostics job={{ ...job, status: 'COMPLETED' }} />)
    expect(screen.getByText('完成但有失败项')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
  it('explains expiration and does not pretend an empty list means no failures', () => {
    mocks.details = { summary: { ...summary, expired: true }, groups: [], items: [], taskError: null, nextCursor: null }
    render(<BackgroundJobDiagnostics job={job} />)
    expect(screen.getByText('诊断明细已过期')).toBeTruthy()
    expect(screen.getByText(/失败项目 13/)).toBeTruthy()
    expect(screen.queryByText('第 1 张 · 001.jpg')).toBeNull()
  })
  it('labels old samples as incomplete and keeps child diagnostics as links', () => {
    mocks.details = { ...mocks.details, summary: { ...summary, source: 'LEGACY_SAMPLES', complete: false } }
    mocks.reports = { ...mocks.reports, failedChildren: 1, childItems: [{ id: 'child-job', type: 'SCAN' }] }
    render(<BackgroundJobDiagnostics job={job} />)
    expect(screen.getByText(/旧执行只保存了部分失败样例/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /child-job/ }).getAttribute('href')).toBe('/admin/tasks?jobId=child-job')
  })
})

import type { ArtworkDedupArtworkPreviewDto, ArtworkDedupOperationDto } from '@pixishelf/job-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateOperationActions } from '../duplicate-operation-actions'
import { DuplicateReimport } from '../duplicate-reimport'
import { exactRelation, member, operation } from './duplicate-maintenance-fixtures'

const mocks = vi.hoisted(() => ({
  directDelete: vi.fn(),
  retryOperation: vi.fn(),
  cancelOperation: vi.fn(),
  prepareCleanup: vi.fn(),
  allowReimport: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn()
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artworkDedup: Object.fromEntries(
      ['directDelete', 'retryOperation', 'cancelOperation', 'prepareCleanup', 'allowReimport'].map((name) => [
        name,
        { mutationOptions: () => ({ mutationFn: mocks[name as keyof typeof mocks] }) }
      ])
    )
  })
}))
let client: QueryClient
function mount(value: ArtworkDedupOperationDto, ready = true) {
  const ui = (current: ArtworkDedupOperationDto, userId = 'user-a', previewReady = ready) => (
    <QueryClientProvider client={client}>
      <DuplicateOperationActions
        operation={current}
        userId={userId}
        disabled={false}
        previewReady={previewReady}
        onUpdate={mocks.update}
        onNewOperation={mocks.update}
        onRefresh={mocks.refresh}
      />
    </QueryClientProvider>
  )
  const view = render(ui(value))
  return {
    ...view,
    change: (current: ArtworkDedupOperationDto, userId = 'user-a', previewReady = ready) =>
      view.rerender(ui(current, userId, previewReady))
  }
}
function confirm() {
  fireEvent.click(screen.getByRole('checkbox', { name: /我理解永久删除/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /已暂停这些文件/ }))
}
beforeEach(() => {
  vi.clearAllMocks()
  for (const [name, mock] of Object.entries(mocks)) {
    if (!['update', 'refresh'].includes(name)) mock.mockResolvedValue(operation())
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
})
describe('direct delete actions', () => {
  it('requires service authority and never renders old isolation, restore or purge actions', () => {
    mount(operation({ allowedActions: ['ISOLATE', 'RESTORE', 'PURGE', 'PREPARE_PURGE'] }))
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('rejects a legacy READY even if a stale client supplies a delete action', () => {
    mount(
      operation({
        preparePurpose: 'ISOLATION',
        protocolVersion: null,
        scopeDigest: null,
        allowedActions: ['DIRECT_DELETE', 'REPREPARE']
      })
    )
    expect(screen.getByText('此预览不能用于直接删除')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /永久删除/ })).toBeNull()
    expect(screen.getByRole('link', { name: '返回检查结果' }).getAttribute('href')).not.toContain('operationId')
  })
  it.each([1, 2] as const)(
    'confirms once using server protocol %d and binds the server scope',
    async (protocolVersion) => {
      mount(operation({ protocolVersion, allowedActions: ['DIRECT_DELETE'] }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
      const submit = screen.getByRole('button', { name: '永久删除 1 部副本' }) as HTMLButtonElement
      expect(submit.disabled).toBe(true)
      expect(screen.getAllByRole('checkbox')).toHaveLength(2)
      expect(
        screen.getAllByRole('checkbox').every((checkbox) => checkbox.getAttribute('aria-checked') === 'false')
      ).toBe(true)
      confirm()
      fireEvent.click(submit)
      fireEvent.click(submit)
      await waitFor(() => expect(mocks.directDelete).toHaveBeenCalledTimes(1))
      expect(mocks.directDelete.mock.calls[0]![0]).toEqual({
        operationId: 'op-1',
        expectedVersion: 1,
        expectedUserId: 'user-a',
        purpose: 'DIRECT_DELETE',
        protocolVersion,
        scopeDigest: 'a'.repeat(64),
        permanentDeleteConfirmed: true,
        organizationImpactConfirmed: true,
        externalWritesStopped: true,
        idempotencyKey: expect.any(String)
      })
    }
  )
  it.each([null, 5])('does not authorize deletion with unsupported protocol %s', (protocolVersion) => {
    mount(
      operation({
        protocolVersion: protocolVersion as ArtworkDedupOperationDto['protocolVersion'],
        allowedActions: ['DIRECT_DELETE']
      })
    )
    expect(screen.getByText('此预览不能用于直接删除')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(mocks.directDelete).not.toHaveBeenCalled()
  })
  it.each([3, 4] as const)(
    'requires the extra content-loss assertion for protocol %s in the same panel',
    async (protocolVersion) => {
      mount(operation({ protocolVersion, allowedActions: ['DIRECT_DELETE'] }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getAllByRole('checkbox')).toHaveLength(3)
      confirm()
      const submit = screen.getByRole('button', { name: '永久删除 1 部副本' }) as HTMLButtonElement
      expect(submit.disabled).toBe(true)
      fireEvent.click(submit)
      expect(mocks.directDelete).not.toHaveBeenCalled()
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: protocolVersion === 4 ? /部分重复作品仍有未配对原件/ : /我确认删除整部作品，包含未配对、未核对的原媒体及全部整理记录/
        })
      )
      fireEvent.click(submit)
      await waitFor(() => expect(mocks.directDelete).toHaveBeenCalledTimes(1))
      expect(mocks.directDelete.mock.calls[0]![0]).toMatchObject({
        protocolVersion,
        differentContentLossConfirmed: true,
        expectedUserId: 'user-a'
      })
    }
  )
  it('requires a loaded frozen preview and resets confirmation for a new version or account', () => {
    const value = operation({ allowedActions: ['DIRECT_DELETE'] })
    const view = mount(value, false)
    expect((screen.getByRole('button', { name: '永久删除 1 部副本' }) as HTMLButtonElement).disabled).toBe(true)
    view.change(value, 'user-a', true)
    confirm()
    expect((screen.getByRole('button', { name: '永久删除 1 部副本' }) as HTMLButtonElement).disabled).toBe(false)
    view.change(operation({ version: 2, allowedActions: ['DIRECT_DELETE'] }), 'user-a', true)
    expect((screen.getByRole('button', { name: '永久删除 1 部副本' }) as HTMLButtonElement).disabled).toBe(true)
    confirm()
    view.change(operation({ version: 2, allowedActions: ['DIRECT_DELETE'] }), 'user-b', true)
    expect(screen.getAllByRole('checkbox').every((check) => check.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('keeps cancellation available beside disabled delete consent while the preview loads', async () => {
    mount(operation({ allowedActions: ['DIRECT_DELETE', 'CANCEL'] }), false)
    expect((screen.getByRole('button', { name: '永久删除 1 部副本' }) as HTMLButtonElement).disabled).toBe(true)
    const cancel = screen.getByRole('button', { name: '取消本次处理' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(false)
    expect(screen.getAllByRole('button', { name: '取消本次处理' })).toHaveLength(1)
    fireEvent.click(cancel)
    await waitFor(() => expect(mocks.cancelOperation).toHaveBeenCalledTimes(1))
    expect(mocks.directDelete).not.toHaveBeenCalled()
  })
  it('queries the same operation after an unknown response and reuses the same delete intent', async () => {
    mocks.directDelete
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(operation({ mode: 'DIRECT_DELETE', status: 'DRAINING' }))
    mount(operation({ allowedActions: ['DIRECT_DELETE'] }))
    confirm()
    fireEvent.click(screen.getByRole('button', { name: '永久删除 1 部副本' }))
    await screen.findByText('提交结果尚未确认')
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '永久删除 1 部副本' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    expect(mocks.directDelete.mock.calls[1]![0]).toEqual(mocks.directDelete.mock.calls[0]![0])
  })
  it('ignores a late delete response after an account switch', async () => {
    let resolve!: (value: ArtworkDedupOperationDto) => void
    mocks.directDelete.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const value = operation({ allowedActions: ['DIRECT_DELETE'] })
    const view = mount(value)
    confirm()
    fireEvent.click(screen.getByRole('button', { name: '永久删除 1 部副本' }))
    await waitFor(() => expect(mocks.directDelete).toHaveBeenCalledTimes(1))
    view.change(value, 'user-b')
    await act(async () => resolve(operation({ mode: 'DIRECT_DELETE', status: 'DRAINING' })))
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it.each(['STALE', 'FAILED', 'BUILDING'] as const)('does not authorize a %s preview', (status) => {
    mount(operation({ status, allowedActions: ['DIRECT_DELETE'] }))
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
  it('does not silently shrink a blocked range into an executable delete', () => {
    const value = operation({ allowedActions: ['DIRECT_DELETE'] })
    mount({ ...value, counts: { ...value.counts, blockedGroups: 1 } })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
  it.each(['DRAINING', 'VERIFYING', 'DELETING'] as const)(
    'uses cancellation before a persisted intent, including %s',
    async (status) => {
      mount(operation({ mode: 'DIRECT_DELETE', status, deleteStartedAt: null, allowedActions: ['CANCEL'] }))
      expect(screen.queryByRole('button', { name: '请求停止' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '取消本次处理' }))
      await waitFor(() => expect(mocks.cancelOperation).toHaveBeenCalledTimes(1))
    }
  )
  it('requests safe stopping after the first intent and continues only the original range without new consent', async () => {
    mount(
      operation({
        mode: 'DIRECT_DELETE',
        originalAction: 'DIRECT_DELETE',
        status: 'RECOVERY_REQUIRED',
        deleteStartedAt: '2026-10-24T00:01:00Z',
        allowedActions: ['RETRY_OPERATION', 'STOP', 'RESTORE', 'PREPARE_PURGE']
      })
    )
    expect(screen.getByText(/只可复核保留作品并继续原删除范围/)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '恢复本批次' })).toBeNull()
    expect(screen.getByRole('button', { name: '请求停止' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复核并继续原删除' }))
    await waitFor(() => expect(mocks.retryOperation).toHaveBeenCalledTimes(1))
    expect(mocks.retryOperation.mock.calls[0]![0]).toEqual({
      operationId: 'op-1',
      expectedVersion: 1,
      expectedUserId: 'user-a',
      idempotencyKey: expect.any(String)
    })
    expect(mocks.directDelete).not.toHaveBeenCalled()
  })
  it('reports a settled stop without claiming execution exit is still pending', () => {
    mount(
      operation({
        mode: 'DIRECT_DELETE',
        status: 'STOPPED',
        deleteStartedAt: '2026-10-24T00:01:00Z',
        stopRequested: true
      })
    )
    expect(screen.getByText(/已删文件无法撤销/)).toBeTruthy()
    expect(screen.queryByText(/正在等待安全文件边界和执行退出/)).toBeNull()
  })
  it('reprepares the persisted original groups with the new purpose and protocol', async () => {
    mount(operation({ status: 'STALE', allowedActions: ['REPREPARE'] }))
    fireEvent.click(screen.getByRole('button', { name: '重新预览原范围' }))
    await waitFor(() => expect(mocks.prepareCleanup).toHaveBeenCalledTimes(1))
    expect(mocks.prepareCleanup.mock.calls[0]![0]).toEqual({
      sourceOperationId: 'op-1',
      expectedOperationVersion: 1,
      expectedUserId: 'user-a',
      purpose: 'DIRECT_DELETE',
      protocolVersion: 1,
      idempotencyKey: expect.any(String)
    })
  })
})
function reimportItems(): ArtworkDedupArtworkPreviewDto[] {
  return [
    {
      ...exactRelation,
      ...member(),
      itemId: 1,
      groupId: 'group-1',
      role: 'COPY',
      status: 'DELETED',
      personalRecords: 'REMOVED',
      mediaCount: '2',
      fileCount: '2',
      reasons: [],
      canAllowReimport: true,
      sources: [
        { sourceId: 'source-1', displayName: '原件 · a.jpg', generation: '2', status: 'TOMBSTONE' },
        { sourceId: 'source-2', displayName: '目录 · 示例', generation: '7', status: 'TOMBSTONE' }
      ]
    }
  ]
}
describe('direct delete source release', () => {
  it('allows only explicitly selected real source generations as a separate future input intent', async () => {
    render(
      <QueryClientProvider client={client}>
        <DuplicateReimport
          operation={operation({ mode: 'DIRECT_DELETE', status: 'DELETED', allowedActions: ['ALLOW_REIMPORT'] })}
          userId="user-a"
          items={reimportItems()}
          disabled={false}
          onUpdate={mocks.update}
          onRefresh={mocks.refresh}
        />
      </QueryClientProvider>
    )
    expect(screen.getByText('目录 · 示例').closest('[data-privacy-sensitive]')).not.toBeNull()
    expect(screen.getByText('原件 · a.jpg').closest('[data-privacy-sensitive]')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '目录 · 示例' }))
    fireEvent.click(screen.getByRole('button', { name: '允许所选 1 个来源重新导入' }))
    expect(screen.getByText(/旧任务不会重新生效/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认允许重新导入' }))
    await waitFor(() => expect(mocks.allowReimport).toHaveBeenCalledTimes(1))
    expect(mocks.allowReimport.mock.calls[0]![0]).toMatchObject({
      sources: [{ sourceId: 'source-2', expectedGeneration: '7' }],
      expectedUserId: 'user-a'
    })
  })
  it('does not invent a source for a local created artwork without a discoverable identity', () => {
    render(
      <QueryClientProvider client={client}>
        <DuplicateReimport
          operation={operation({ mode: 'DIRECT_DELETE', status: 'DELETED', allowedActions: ['ALLOW_REIMPORT'] })}
          userId="user-a"
          items={[{ ...reimportItems()[0]!, sources: [], canAllowReimport: false }]}
          disabled={false}
          onUpdate={mocks.update}
          onRefresh={mocks.refresh}
        />
      </QueryClientProvider>
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('heading', { name: '允许重新导入' })).toBeNull()
  })
})

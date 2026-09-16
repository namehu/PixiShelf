import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscoveryCreatorDialog, type DiscoveryCreatorDialogState } from '../discovery-creator-dialog'

const mocks = vi.hoisted(() => ({ bind: vi.fn(), defaults: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveSearch: {
      bindCreators: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.bind }) },
      setDefaultCreators: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.defaults }) }
    }
  })
}))
vi.mock('@/components/creators/creator-picker', () => ({
  CreatorPicker: ({ onChange }: { onChange: (value: { id: number; name: string }[]) => void }) => (
    <button onClick={() => onChange([{ id: 7, name: 'Alice' }])}>选择 Alice</button>
  )
}))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))
const state: DiscoveryCreatorDialogState = {
  mode: 'bind',
  sourceId: 'source',
  itemIds: ['a', 'b'],
  immediateCount: 1,
  initialCreators: []
}
function show(value = state) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <DiscoveryCreatorDialog state={value} onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)} />
    </QueryClientProvider>
  )
}
const success = { counts: { created: 1, applied: 1, skipped: 0, failed: 0, conflict: 0 }, items: [] }
describe('discovery creator confirmation and retries', () => {
  beforeEach(() => {
    mocks.bind.mockReset()
    mocks.defaults.mockReset()
    sessionStorage.clear()
  })
  afterEach(cleanup)
  it('shows immediate and pending counts, requires creators and only submits on confirmation', async () => {
    mocks.bind.mockResolvedValue(success)
    show()
    expect(screen.getByText(/预计 1 个立即生效，1 个归档后生效/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '确认保存' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('选择 Alice'))
    expect(mocks.bind).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }))
    await waitFor(() => expect(mocks.bind).toHaveBeenCalledOnce())
    expect(mocks.bind.mock.calls[0]![0]).toMatchObject({ artistIds: [7], itemIds: ['a', 'b'], cancel: false })
  })
  it('reuses the exact request after a lost response and remount', async () => {
    mocks.bind.mockRejectedValueOnce(new Error('network')).mockResolvedValue(success)
    const first = show()
    fireEvent.click(screen.getByText('选择 Alice'))
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }))
    await screen.findByText('操作未完成')
    const request = mocks.bind.mock.calls[0]![0]
    first.unmount()
    show()
    fireEvent.click(await screen.findByRole('button', { name: '确认原操作结果' }))
    await waitFor(() => expect(mocks.bind).toHaveBeenCalledTimes(2))
    expect(mocks.bind.mock.calls[1]![0]).toEqual(request)
  })
  it('retries only known failed targets using a new request id', async () => {
    mocks.bind
      .mockResolvedValueOnce({
        ...success,
        counts: { ...success.counts, failed: 1 },
        items: [{ targetId: 'b', result: 'FAILED', message: '失败' }]
      })
      .mockResolvedValue(success)
    show()
    fireEvent.click(screen.getByText('选择 Alice'))
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试未完成项（1）' }))
    await waitFor(() => expect(mocks.bind).toHaveBeenCalledTimes(2))
    expect(mocks.bind.mock.calls[1]![0].itemIds).toEqual(['b'])
    expect(mocks.bind.mock.calls[1]![0].requestId).not.toBe(mocks.bind.mock.calls[0]![0].requestId)
  })
  it('allows clearing source defaults without submitting a work binding', async () => {
    mocks.defaults.mockResolvedValue({ saved: true })
    show({ ...state, mode: 'defaults', initialCreators: [] })
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }))
    await waitFor(() => expect(mocks.defaults).toHaveBeenCalledOnce())
    expect(mocks.defaults.mock.calls[0]![0]).toEqual({ sourceId: 'source', artistIds: [] })
    expect(mocks.bind).not.toHaveBeenCalled()
  })

  it('keeps the recovered artists when retrying a known failed subset', async () => {
    const recovered = {
      sourceId: 'source',
      itemIds: ['a', 'b'],
      artistIds: [99],
      requestId: crypto.randomUUID(),
      cancel: false
    }
    sessionStorage.setItem('discovery-creator-request:source:bind', JSON.stringify(recovered))
    mocks.bind
      .mockResolvedValueOnce({
        ...success,
        counts: { ...success.counts, failed: 1 },
        items: [{ targetId: 'b', result: 'FAILED' }]
      })
      .mockResolvedValue(success)
    show()
    fireEvent.click(await screen.findByRole('button', { name: '确认原操作结果' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试未完成项（1）' }))
    await waitFor(() => expect(mocks.bind).toHaveBeenCalledTimes(2))
    expect(mocks.bind.mock.calls[1]![0]).toMatchObject({ itemIds: ['b'], artistIds: [99] })
    expect(mocks.bind.mock.calls[1]![0].requestId).not.toBe(recovered.requestId)
  })
})

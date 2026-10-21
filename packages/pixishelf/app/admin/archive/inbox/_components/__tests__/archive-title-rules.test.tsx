import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchiveTitleRules } from '@pixishelf/job-contracts'
import { ArchiveTitleRuleFields } from '../archive-title-rule-fields'
import { ArchiveTitleRuleDialog } from '../archive-title-rule-dialog'

const api = vi.hoisted(() => ({
  latestRulePreview: vi.fn(),
  rulePreview: vi.fn(),
  rulePreviewItems: vi.fn(),
  previewRules: vi.fn(),
  applyRules: vi.fn(),
  cancelRulePreview: vi.fn()
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveSearch: {
      pathKey: () => ['archiveSearch'],
      ...Object.fromEntries(
        Object.entries(api).map(([name, call]) => [
          name,
          {
            queryOptions: (input: object, options = {}) => ({
              queryKey: ['archiveSearch', name, input],
              queryFn: () => call(input),
              ...options
            }),
            infiniteQueryOptions: (input: object, options = {}) => ({
              queryKey: ['archiveSearch', name, input],
              queryFn: () => call(input),
              initialPageParam: null,
              ...options
            }),
            mutationOptions: (options = {}) => ({ mutationFn: call, ...options })
          }
        ])
      )
    }
  })
}))

const rules: ArchiveTitleRules = { version: 1, any: [{ operator: 'CONTAINS', text: '[RAG]' }], all: [], none: [] }
const saved = {
  id: 'revision',
  status: 'READY',
  jobStatus: 'COMPLETED',
  rules,
  checkedCount: 1105,
  acceptedCount: 93,
  filteredCount: 1012,
  newlyAcceptedCount: 0,
  newlyFilteredCount: 991,
  manualCount: 2
}
const onClose = vi.fn()
function dialog(
  activeScan = false,
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
) {
  return render(
    <QueryClientProvider client={client}>
      <ArchiveTitleRuleDialog
        sourceId="source"
        rulesVersion={1}
        initialRules={rules}
        activeScan={activeScan}
        onClose={onClose}
      />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  api.latestRulePreview.mockResolvedValue(null)
  api.rulePreview.mockResolvedValue(saved)
  api.rulePreviewItems.mockResolvedValue({ items: [], nextCursor: null })
  api.previewRules.mockResolvedValue({ revisionId: 'revision' })
  api.applyRules.mockResolvedValue({ applied: true, rulesVersion: 2 })
})
afterEach(cleanup)

describe('title rules editor and preview', () => {
  it('keeps at least one positive condition and edits independent groups', () => {
    function Editor() {
      const [value, setValue] = useState(rules)
      return <ArchiveTitleRuleFields value={value} onChange={setValue} />
    }
    render(<Editor />)
    expect((screen.getByRole('button', { name: '移除满足任一条件第 1 条' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(
      within(screen.getByRole('group', { name: '满足任一条件' })).getByRole('button', { name: '添加条件' })
    )
    fireEvent.change(screen.getByLabelText('满足任一条件 2 文本'), { target: { value: '[r18AnimeGirls/RAG]' } })
    fireEvent.click(screen.getByRole('button', { name: '添加排除条件' }))
    fireEvent.change(screen.getByLabelText('排除条件 1 文本'), { target: { value: 'Ragnarok' } })
    fireEvent.click(screen.getByRole('button', { name: '移除满足任一条件第 1 条' }))
    expect((screen.getByLabelText('满足任一条件 1 文本') as HTMLInputElement).value).toBe('[r18AnimeGirls/RAG]')
    expect((screen.getByLabelText('排除条件 1 文本') as HTMLInputElement).value).toBe('Ragnarok')
  })
  it('requires a completed preview before applying, and shows full-set counts and empty details', async () => {
    dialog()
    expect(screen.queryByRole('button', { name: '应用规则' })).toBeNull()
    fireEvent.change(screen.getByLabelText('试算一个标题'), { target: { value: '[Other] Ragnarok' } })
    expect(screen.getByText('未满足接纳条件')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '预览全部候选' }))
    expect(await screen.findByText(/共 1105 条/)).toBeTruthy()
    expect(await screen.findByText('这个范围没有候选。')).toBeTruthy()
    expect(api.previewRules).toHaveBeenCalledWith(
      expect.objectContaining({ rules, rulesVersion: 1 }),
      expect.anything()
    )
    fireEvent.click(screen.getByRole('button', { name: '应用规则' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
  it('restores durable preview state and disables apply during an active scan', async () => {
    api.latestRulePreview.mockResolvedValue(saved)
    dialog(true)
    expect(((await screen.findByRole('button', { name: '应用规则' })) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/当前有活动扫描/)).toBeTruthy()
  })
  it('restores a newly queued preview on the first reopen despite a stale cached latest result', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    api.latestRulePreview.mockResolvedValue({ ...saved, status: 'APPLIED' })
    const first = dialog(false, client)
    await waitFor(() =>
      expect(client.getQueryData(['archiveSearch', 'latestRulePreview', { sourceId: 'source' }])).toMatchObject({
        status: 'APPLIED'
      })
    )
    const pending = { ...saved, status: 'PENDING', jobStatus: 'PENDING', checkedCount: 0 }
    let resolveLatest!: (value: typeof pending) => void
    const latestResponse = new Promise<typeof pending>((resolve) => {
      resolveLatest = resolve
    })
    api.latestRulePreview.mockImplementation(() => latestResponse)
    api.rulePreview.mockResolvedValue(pending)
    fireEvent.click(screen.getByRole('button', { name: '预览全部候选' }))
    await screen.findByRole('button', { name: '取消预览' })
    first.unmount()
    dialog(false, client)
    resolveLatest(pending)
    expect(await screen.findByRole('button', { name: '取消预览' })).toBeTruthy()
    expect((screen.getByLabelText('满足任一条件 1 文本') as HTMLInputElement).disabled).toBe(true)
  })
  it('rechecks an apply conflict and offers a fresh preview without discarding the draft', async () => {
    api.latestRulePreview.mockResolvedValue(saved)
    api.applyRules.mockRejectedValueOnce(new Error('preview stale'))
    dialog()
    await screen.findByRole('button', { name: '应用规则' })
    api.rulePreview.mockResolvedValue({ ...saved, status: 'STALE' })
    fireEvent.click(screen.getByRole('button', { name: '应用规则' }))
    expect(await screen.findByText('预览已过期')).toBeTruthy()
    expect(screen.getByRole('button', { name: '预览全部候选' })).toBeTruthy()
    expect((screen.getByLabelText('满足任一条件 1 文本') as HTMLInputElement).value).toBe('[RAG]')
  })
})

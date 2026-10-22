import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateArchiveTitleRules, type ArchiveTitleRules } from '@pixishelf/job-contracts'
import { ArchiveTitleRuleFields } from '../archive-title-rule-fields'
import { ArchiveTitleRuleSheet } from '../archive-title-rule-sheet'
import { ArchiveTitleMatchEvidence } from '../archive-title-match-evidence'

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
      <ArchiveTitleRuleSheet
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
  it('shows saved case settings accurately and defaults new rows to case-sensitive matching', () => {
    const onChange = vi.fn()
    const input: ArchiveTitleRules = {
      version: 2,
      any: [{ operator: 'REGEX', text: '^\\[RAG\\]' }],
      all: [],
      none: [{ operator: 'CONTAINS', text: 'skip' }]
    }
    function Editor() {
      const [value, setValue] = useState(input)
      return (
        <ArchiveTitleRuleFields
          value={value}
          onChange={(next) => {
            onChange(next)
            setValue(next)
          }}
        />
      )
    }
    render(<Editor />)
    const checkbox = screen.getByRole('checkbox', { name: '满足任一条件 1 区分大小写' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 2, any: [{ operator: 'REGEX', text: '^\\[RAG\\]', ignoreCase: false }] })
    )
    expect(screen.getByRole('checkbox', { name: '排除条件 1 区分大小写' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText('满足任一条件 1 文本'), { target: { value: '[' } })
    expect(screen.getByLabelText('满足任一条件 1 文本').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('正则表达式无效')
    fireEvent.change(screen.getByLabelText('满足任一条件 1 文本'), { target: { value: '\\D+[A-Z]' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onChange.mock.lastCall![0].any[0]).toEqual({ operator: 'REGEX', text: '\\D+[A-Z]', ignoreCase: false })
    fireEvent.click(
      within(screen.getByRole('group', { name: '满足任一条件' })).getByRole('button', { name: '添加条件' })
    )
    expect(screen.getByRole('checkbox', { name: '满足任一条件 2 区分大小写' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '满足任一条件 2 区分大小写' }))
    expect(onChange.mock.lastCall![0].any[1].ignoreCase).toBe(true)
  })

  it('keeps help hidden until mouse hover or touch activation, and fits the sheet to the visible keyboard viewport', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const viewport = Object.assign(new EventTarget(), { height: 500, offsetTop: 12 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    try {
      dialog()
      const sheet = screen.getByRole('dialog', { name: '本地接纳规则' })
      expect(sheet.getAttribute('data-slot')).toBe('sheet-content')
      expect(sheet.style.height).toBe('500px')
      expect(sheet.style.top).toBe('12px')
      act(() => {
        viewport.height = 320
        viewport.offsetTop = 40
        viewport.dispatchEvent(new Event('resize'))
      })
      expect(sheet.style.height).toBe('320px')
      expect(sheet.style.top).toBe('40px')
      const helpButton = screen.getByRole('button', { name: '满足任一条件说明' })
      expect(screen.queryByText('至少命中其中一条，支持多个标记或别名。')).toBeNull()
      fireEvent(helpButton, Object.assign(new MouseEvent('pointerover', { bubbles: true }), { pointerType: 'mouse' }))
      expect(await screen.findByText('至少命中其中一条，支持多个标记或别名。')).toBeTruthy()
      fireEvent.keyDown(screen.getByRole('dialog', { name: '满足任一条件说明' }), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByText('至少命中其中一条，支持多个标记或别名。')).toBeNull())
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: '满足任一条件第 1 条说明' }))
      expect(await screen.findByText('标题中包含输入文本即可；方括号等标点按原样匹配。')).toBeTruthy()
    } finally {
      cleanup()
      if (original) Object.defineProperty(window, 'visualViewport', original)
      else Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  it('shows the matching bilingual title and highlights without expanding, including older saved evaluations', () => {
    const evaluation = evaluateArchiveTitleRules(rules, {
      origin: 'HISTORICAL',
      titles: ['豊川祥子 ウェディングドレス', '😀 &amp; [RAG] Wedding']
    })
    delete evaluation.matchRanges
    const { container } = render(<ArchiveTitleMatchEvidence evaluation={evaluation} />)
    const heading = screen.getByText('命中标题 · 历史快照')
    expect(heading.closest('details')).toBeNull()
    const highlight = container.querySelector('mark')!
    expect(highlight.textContent).toBe('[RAG]')
    expect(highlight.closest('details')).toBeNull()
    expect(highlight.closest('[data-privacy-sensitive]')?.textContent).toBe('😀 & [RAG] Wedding')
    expect(container.querySelector('details')!.open).toBe(false)
    fireEvent.click(screen.getByText('全部判断标题（2）'))
    expect(container.querySelector('details')!.open).toBe(true)
  })

  it('highlights regex exclusions separately from a preserved manual acceptance', () => {
    const evaluation = evaluateArchiveTitleRules(
      { ...rules, version: 2, none: [{ operator: 'REGEX', text: 'skip\\d+' }] },
      { origin: 'REMOTE', titles: ['[RAG] Title', 'SKIP12 &amp; Test'] }
    )
    const { container } = render(<ArchiveTitleMatchEvidence evaluation={evaluation} decision="INCLUDE" />)
    expect(screen.getByText('手动接纳')).toBeTruthy()
    expect(screen.getByText('触发排除的标题')).toBeTruthy()
    expect(container.querySelector('mark')!.textContent).toBe('SKIP12')
    expect(container.querySelector('mark')!.className).toContain('text-destructive')
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
  it('shows the effective decision separately from rule evidence and decodes private display titles', async () => {
    api.latestRulePreview.mockResolvedValue(saved)
    api.rulePreviewItems.mockResolvedValue({
      items: [
        {
          catalogItemId: 'manual-in',
          accepted: true,
          reviewDecision: 'INCLUDE',
          title: 'Chloe &amp; Amber - Ragnarok'
        },
        { catalogItemId: 'manual-out', accepted: false, reviewDecision: 'EXCLUDE', title: '[RAG] Fluorite' },
        { catalogItemId: 'automatic', accepted: false, reviewDecision: 'AUTO', title: '[Other] Ragnarok' }
      ].map(({ title, ...item }) => ({
        ...item,
        catalogItem: { title, externalId: item.catalogItemId },
        evaluation: evaluateArchiveTitleRules(rules, { origin: 'REMOTE', titles: [title] })
      })),
      nextCursor: null
    })
    dialog()
    const decodedTitle = await screen.findByText('Chloe & Amber - Ragnarok', { selector: 'article > div > p' })
    expect(decodedTitle.hasAttribute('data-privacy-sensitive')).toBe(true)
    const accepted = within(decodedTitle.closest('article')!)
    expect(accepted.getByText('接纳')).toBeTruthy()
    expect(accepted.getByText('手动接纳')).toBeTruthy()
    expect(accepted.getByText('未满足接纳条件')).toBeTruthy()
    const excluded = within(screen.getByText('[RAG] Fluorite', { selector: 'article > div > p' }).closest('article')!)
    expect(excluded.getByText('过滤')).toBeTruthy()
    expect(excluded.getByText('手动排除')).toBeTruthy()
    expect(excluded.getByText('命中接纳条件')).toBeTruthy()
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

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSuggestionsResponse } from '@/schemas/search.dto'

import { SearchBox } from '../search-box'

const mocks = vi.hoisted(() => ({
  queryOptions: vi.fn((input: unknown) => ({ queryKey: ['search', input] })),
  useQuery: vi.fn(),
  result: {
    data: { suggestions: [] } as SearchSuggestionsResponse,
    isLoading: false,
    isError: false
  }
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    search: {
      suggestions: {
        queryOptions: mocks.queryOptions
      }
    }
  })
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery
}))

beforeEach(() => {
  vi.useFakeTimers()
  mocks.queryOptions.mockClear()
  mocks.useQuery.mockReset().mockImplementation(() => mocks.result)
  mocks.result.isLoading = false
  mocks.result.isError = false
  mocks.result.data = {
    suggestions: [{ type: 'artist', value: '42', label: '测试艺术家', metadata: { id: 42, artworkCount: 3 } }]
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function settleQuery() {
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
}

describe('SearchBox', () => {
  it('names the combobox and exposes suggestions as keyboard-native options', () => {
    const onSuggestionClick = vi.fn()

    render(<SearchBox value="测试" onSuggestionClick={onSuggestionClick} />)

    const input = screen.getByRole('combobox', { name: '搜索作品、艺术家或标签' })
    fireEvent.focus(input)

    const option = screen.getByRole('option', { name: /测试艺术家/ })
    expect(option.tagName).toBe('BUTTON')
    fireEvent.click(option)

    expect(onSuggestionClick).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'artist', value: '42', label: '测试艺术家' })
    )
  })

  it.each(['猫', 'CAT'])(
    'looks up a translated # query %s after debounce and selects its stable tag ID',
    async (query) => {
      const suggestion = {
        type: 'tag' as const,
        value: 'ねこ',
        label: '#ねこ · 猫咪 · Cat',
        metadata: { id: 17, artworkCount: 6 }
      }
      mocks.result.data = { suggestions: [suggestion] }
      const onSuggestionClick = vi.fn()
      const onSearch = vi.fn()
      render(<SearchBox onSuggestionClick={onSuggestionClick} onSearch={onSearch} />)
      const input = screen.getByRole('combobox')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: `# ${query} ` } })

      expect(screen.queryByRole('option')).toBeNull()
      expect(mocks.useQuery.mock.lastCall?.[0].enabled).toBe(false)
      await settleQuery()

      expect(mocks.queryOptions).toHaveBeenLastCalledWith({ q: query, mode: 'tag', limit: 8 })
      expect(mocks.useQuery.mock.lastCall?.[0].enabled).toBe(true)
      expect(screen.getByRole('option', { name: /ねこ · 猫咪 · Cat/ })).toBeTruthy()
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onSuggestionClick).toHaveBeenCalledWith(suggestion)
      expect(onSearch).not.toHaveBeenCalled()
      expect((input as HTMLInputElement).value).toBe('')
    }
  )

  it('selects the clicked ID even when multiple tags have the same original name', async () => {
    const second = { type: 'tag' as const, value: 'cat', label: '#cat', metadata: { id: 18 } }
    mocks.result.data = {
      suggestions: [{ type: 'tag', value: 'cat', label: '#cat · 猫', metadata: { id: 17 } }, second]
    }
    const onSuggestionClick = vi.fn()
    render(<SearchBox value="#cat" onSuggestionClick={onSuggestionClick} />)
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.click(screen.getAllByRole('option')[1]!)

    expect(onSuggestionClick).toHaveBeenCalledWith(second)
  })

  it('leaves existing filters alone when Enter has no highlighted tag', () => {
    mocks.result.data = { suggestions: [{ type: 'tag', value: 'ねこ', label: '#ねこ · 猫', metadata: { id: 17 } }] }
    const onSearch = vi.fn()
    const onSuggestionClick = vi.fn()
    render(<SearchBox value="#猫" onSearch={onSearch} onSuggestionClick={onSuggestionClick} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)

    expect(screen.getByRole('status').textContent).toContain('请选择一个标签')
    expect(onSearch).not.toHaveBeenCalled()
    expect(onSuggestionClick).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'explains an empty or failed tag search without submitting a keyword (error: %s)',
    (isError) => {
      mocks.result.data = { suggestions: [] }
      mocks.result.isError = isError
      const onSearch = vi.fn()
      const onSuggestionClick = vi.fn()
      render(<SearchBox value="#未知" onSearch={onSearch} onSuggestionClick={onSuggestionClick} />)
      const input = screen.getByRole('combobox')
      fireEvent.focus(input)
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)

      expect(screen.getByRole(isError ? 'alert' : 'status').textContent).toContain(isError ? '加载失败' : '未找到标签')
      expect(onSearch).not.toHaveBeenCalled()
      expect(onSuggestionClick).not.toHaveBeenCalled()
    }
  )

  it('does not request an empty # query and returns to normal mode after removing the prefix', async () => {
    const onSearch = vi.fn()
    render(<SearchBox value="#  " onSearch={onSearch} onSuggestionClick={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(mocks.useQuery.mock.lastCall?.[0].enabled).toBe(false)
    expect(screen.getByRole('status').textContent).toContain('输入标签原名')

    fireEvent.change(input, { target: { value: 'cat' } })
    await settleQuery()
    expect(mocks.queryOptions).toHaveBeenLastCalledWith({ q: 'cat', mode: 'normal', limit: 8 })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSearch).toHaveBeenCalledWith('cat')

    fireEvent.change(input, { target: { value: ' ' } })
    await settleQuery()
    expect(mocks.useQuery.mock.lastCall?.[0].enabled).toBe(false)
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps one-character normal searches below the suggestion threshold', () => {
    render(<SearchBox value="a" onSuggestionClick={vi.fn()} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(mocks.useQuery.mock.lastCall?.[0].enabled).toBe(false)
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('keeps unselected # lookups out of the parent keyword draft', () => {
    const onValueChange = vi.fn()
    render(<SearchBox value="landscape" onValueChange={onValueChange} onSuggestionClick={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '#猫' } })
    fireEvent.change(input, { target: { value: '# ' } })
    expect(onValueChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '猫' } })
    expect(onValueChange).toHaveBeenCalledWith('猫')
  })

  it('does not select an older highlighted tag while a new query is debouncing', () => {
    mocks.result.data = { suggestions: [{ type: 'tag', value: 'ねこ', label: '#ねこ · 猫', metadata: { id: 17 } }] }
    const onSuggestionClick = vi.fn()
    const onSearch = vi.fn()
    render(<SearchBox value="#猫" onSuggestionClick={onSuggestionClick} onSearch={onSearch} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.change(input, { target: { value: '#犬' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.queryByRole('option')).toBeNull()
    expect(onSuggestionClick).not.toHaveBeenCalled()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('dismisses empty tag feedback with Escape', () => {
    mocks.result.data = { suggestions: [] }
    render(<SearchBox value="#未知" onSuggestionClick={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getByRole('status')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps literal keyword behavior for callers that cannot apply tag selections', () => {
    const onSearch = vi.fn()
    render(<SearchBox value="#cat" onSearch={onSearch} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(mocks.queryOptions).toHaveBeenLastCalledWith({ q: '#cat', mode: 'normal', limit: 8 })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSearch).toHaveBeenCalledWith('#cat')
  })
})

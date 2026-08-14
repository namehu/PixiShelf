import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SearchBox } from '../search-box'

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    search: {
      suggestions: {
        queryOptions: () => ({})
      }
    }
  })
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      suggestions: [
        {
          type: 'artist',
          value: '42',
          label: '测试艺术家',
          metadata: { id: 42, artworkCount: 3 }
        }
      ]
    },
    isLoading: false
  })
}))

afterEach(cleanup)

describe('SearchBox', () => {
  it('names the combobox and exposes suggestions as keyboard-native options', () => {
    const onSuggestionClick = vi.fn()

    render(<SearchBox onSuggestionClick={onSuggestionClick} />)

    const input = screen.getByRole('combobox', { name: '搜索作品、艺术家或标签' })
    fireEvent.focus(input)

    const option = screen.getByRole('option', { name: /测试艺术家/ })
    expect(option.tagName).toBe('BUTTON')
    fireEvent.click(option)

    expect(onSuggestionClick).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'artist', value: '42', label: '测试艺术家' })
    )
  })
})

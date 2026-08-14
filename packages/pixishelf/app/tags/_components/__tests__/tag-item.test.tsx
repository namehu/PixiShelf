import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Tag } from '@/types'
import { TagItem } from '../tag-item'

afterEach(cleanup)

describe('TagItem', () => {
  it('uses a real link and leaves the artwork count outside the link', () => {
    const tag = {
      id: 12,
      name: 'landscape',
      name_zh: '风景',
      name_en: null,
      description: null,
      artworkCount: 81,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    } as Tag

    render(<TagItem tag={tag} />)

    expect(screen.getByRole('link', { name: 'landscape' }).getAttribute('href')).toBe('/tags/12')
    const count = screen.getByText('81')
    expect(count.closest('a')).toBeNull()
    expect(count.closest('.select-none')).toBeNull()
  })
})

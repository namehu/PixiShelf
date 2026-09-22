import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkPreviewPreference } from '../artwork-preview-preference'
import { ARTWORK_DETAIL_STORAGE_KEY, useArtworkDetailPreferences } from '@/store/use-artwork-detail-preferences'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  localStorage.clear()
  useArtworkDetailPreferences.getState().setPreviewCount(10)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('artwork preview preference', () => {
  it('commits bounded integers locally and restores the saved preference on remount', () => {
    const view = render(<ArtworkPreviewPreference />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '101' } })
    fireEvent.blur(input)
    expect(input.value).toBe('100')
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(JSON.parse(localStorage.getItem(ARTWORK_DETAIL_STORAGE_KEY)!).state.previewCount).toBe(7)
    view.unmount()
    render(<ArtworkPreviewPreference />)
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('7')
  })

  it('keeps the previous value when an empty input is committed', () => {
    render(<ArtworkPreviewPreference />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(input.value).toBe('10')
  })
})

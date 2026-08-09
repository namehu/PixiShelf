import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRouter } from 'next/navigation'
import { NAV_CURRENT_KEY, NAV_PREVIOUS_KEY, useSafeBack } from '../use-safe-back'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn()
}))

function BackHarness({ fallbackHref }: { fallbackHref: string }) {
  const safeBack = useSafeBack(fallbackHref)
  return <button onClick={safeBack}>返回</button>
}

const back = vi.fn()
const push = vi.fn()

beforeEach(() => {
  sessionStorage.clear()
  window.history.replaceState({}, '', '/artworks/42')
  vi.mocked(useRouter).mockReturnValue({ back, push } as unknown as ReturnType<typeof useRouter>)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useSafeBack', () => {
  it('uses browser history when a previous in-app path is tracked', () => {
    sessionStorage.setItem(NAV_CURRENT_KEY, '/artworks/42')
    sessionStorage.setItem(NAV_PREVIOUS_KEY, '/artists/7')

    render(<BackHarness fallbackHref="/artworks" />)
    fireEvent.click(screen.getByRole('button', { name: '返回' }))

    expect(back).toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
  })

  it('uses the section fallback when no previous in-app path is available', () => {
    render(<BackHarness fallbackHref="/series" />)
    fireEvent.click(screen.getByRole('button', { name: '返回' }))

    expect(push).toHaveBeenCalledWith('/series')
    expect(back).not.toHaveBeenCalled()
  })
})

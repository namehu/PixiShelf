import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewerRatingDialog } from '../viewer-rating-dialog'
import type { ArtworkRatingLevel } from '@/schemas/artwork-rating.dto'

const makeRating = (level: ArtworkRatingLevel = null) => ({
  level,
  confirmedLevel: level,
  isLoading: false,
  isSaving: false,
  error: null as Error | null,
  setLevel: vi.fn(),
  retry: vi.fn()
})
afterEach(cleanup)

describe('viewer rating picker', () => {
  it.each([null, 1, 2, 3, 4] as const)(
    'allows all positive ratings and clearing from %s without writing on open',
    (level) => {
      const rating = makeRating(level)
      render(
        <ViewerRatingDialog
          open
          onOpenChange={vi.fn()}
          rating={rating}
          disabled={false}
          returnFocusRef={{ current: null }}
        />
      )
      expect(rating.setLevel).not.toHaveBeenCalled()
      for (const [label, target] of [
        ['喜欢', 2],
        ['超爱', 3],
        ['夯爆了', 4],
        ['清除评分', null]
      ] as const) {
        fireEvent.click(screen.getByRole('button', { name: label }))
        expect(rating.setLevel).toHaveBeenLastCalledWith(target)
      }
    }
  )
  it('keeps pending and failed choices open, retries the same target, then closes and restores focus', async () => {
    const rating = makeRating()
    const close = vi.fn()
    const heart = document.createElement('button')
    document.body.append(heart)
    const props = { open: true, onOpenChange: close, rating, disabled: false, returnFocusRef: { current: heart } }
    const view = render(<ViewerRatingDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '超爱' }))
    view.rerender(<ViewerRatingDialog {...props} rating={{ ...rating, level: 3, isSaving: true }} />)
    expect(close).not.toHaveBeenCalled()
    view.rerender(<ViewerRatingDialog {...props} rating={{ ...rating, error: new Error('offline') }} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(rating.retry).toHaveBeenCalledOnce()
    view.rerender(<ViewerRatingDialog {...props} rating={{ ...rating, level: 3, isSaving: true }} />)
    expect(close).not.toHaveBeenCalled()
    view.rerender(<ViewerRatingDialog {...props} rating={{ ...rating, level: 3, confirmedLevel: 3 }} />)
    expect(close).toHaveBeenCalledWith(false)
    view.rerender(<ViewerRatingDialog {...props} open={false} />)
    await waitFor(() => expect(document.activeElement).toBe(heart))
    heart.remove()
  })
  it('closes with Escape and restores focus to the heart', async () => {
    const close = vi.fn()
    const heart = document.createElement('button')
    document.body.append(heart)
    const props = {
      open: true,
      onOpenChange: close,
      rating: makeRating(),
      disabled: false,
      returnFocusRef: { current: heart }
    }
    const view = render(<ViewerRatingDialog {...props} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(close).toHaveBeenCalledWith(false)
    view.rerender(<ViewerRatingDialog {...props} open={false} />)
    await act(async () => {})
    await waitFor(() => expect(document.activeElement).toBe(heart))
    heart.remove()
  })
})

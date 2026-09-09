import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatorReviewPage } from '../creator-review-page'

const state = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => state.params }))
vi.mock('@/components/creators/creator-maintenance-panel', () => ({
  CreatorMaintenancePanel: ({ artworkIds, initialPlanId }: { artworkIds: number[]; initialPlanId: string }) => (
    <div data-testid="review">{JSON.stringify({ artworkIds, initialPlanId })}</div>
  )
}))
afterEach(cleanup)
describe('standalone creator review page', () => {
  it('restores a single artwork and the saved check after reloading', () => {
    state.params = new URLSearchParams('artwork=50&plan=saved-check')
    render(<CreatorReviewPage />)
    expect(screen.getByTestId('review').textContent).toContain('"artworkIds":[50]')
    expect(screen.getByTestId('review').textContent).toContain('saved-check')
  })
  it('blocks a missing selection instead of mounting an all-artwork form', () => {
    state.params = new URLSearchParams('selection=')
    render(<CreatorReviewPage />)
    expect(screen.queryByTestId('review')).toBeNull()
    expect(screen.getByText(/没有找到之前选择的作品/)).toBeTruthy()
  })
})

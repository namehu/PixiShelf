import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveIntakeRetryActions } from '../archive-intake-item-actions'

describe('archive intake retry actions', () => {
  afterEach(() => cleanup())

  it('offers direct and corrected retries for a retryable failure', () => {
    const onRetry = vi.fn()
    const onReplace = vi.fn()

    render(
      <ArchiveIntakeRetryActions
        item={{ id: 'item-79', status: 'FAILED', retryable: true } as any}
        actionPending={false}
        retrying={false}
        onRetry={onRetry}
        onReplace={onReplace}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '直接重试' }))
    fireEvent.click(screen.getByRole('button', { name: '修改并重试' }))

    expect(onRetry).toHaveBeenCalledWith('item-79')
    expect(onReplace).toHaveBeenCalledWith('item-79')
  })

  it('requires a corrected link for a permanent failure', () => {
    render(
      <ArchiveIntakeRetryActions
        item={{ id: 'item-80', status: 'FAILED', retryable: false } as any}
        actionPending={false}
        retrying={false}
        onRetry={vi.fn()}
        onReplace={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: '直接重试' })).toBeNull()
    expect(screen.getByRole('button', { name: '修改并重试' })).toBeTruthy()
  })

  it('disables both actions while another intake mutation is pending', () => {
    render(
      <ArchiveIntakeRetryActions
        item={{ id: 'item-81', status: 'FAILED', retryable: true } as any}
        actionPending
        retrying
        onRetry={vi.fn()}
        onReplace={vi.fn()}
      />
    )

    expect((screen.getByRole('button', { name: '正在直接重试' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '修改并重试' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

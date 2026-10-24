import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuplicateWorkspace } from '../duplicate-workspace'

vi.mock('../duplicate-review', () => ({ DuplicateReview: () => null }))
vi.mock('../duplicate-operations', () => ({
  DuplicateOperations: ({ onOpen }: { onOpen: (id: string) => void }) => (
    <button onClick={() => onOpen('op-next')}>打开下一批次</button>
  )
}))
vi.mock('../duplicate-operation-sheet', () => ({
  DuplicateOperationSheet: ({
    operationId,
    userId,
    onClose
  }: {
    operationId: string
    userId: string
    onClose: () => void
  }) => (
    <div role="dialog" aria-label={`${userId}:${operationId}`}>
      <button onClick={onClose}>关闭批次</button>
    </div>
  )
}))
afterEach(cleanup)
describe('duplicate workspace URL', () => {
  it('restores the exact persisted operation from the URL and removes it when closed', async () => {
    const onUrlUpdate = vi.fn()
    render(
      <NuqsTestingAdapter
        hasMemory
        // The memory adapter rerenders on URL updates; resetting its global queue during that render drops a rapid second navigation.
        resetUrlUpdateQueueOnMount={false}
        searchParams="?artistId=7&operationId=op-saved"
        onUrlUpdate={onUrlUpdate}
      >
        <DuplicateWorkspace userId="user-a" artistId={7} run={null}>
          <p>检查摘要</p>
        </DuplicateWorkspace>
      </NuqsTestingAdapter>
    )
    expect(screen.getByRole('dialog', { name: 'user-a:op-saved' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '删除记录' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '关闭批次' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get('operationId')).toBeNull()
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get('artistId')).toBe('7')
    fireEvent.click(screen.getByRole('button', { name: '打开下一批次' }))
    await screen.findByRole('dialog', { name: 'user-a:op-next' })
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get('operationId')).toBe('op-next')
  })
})

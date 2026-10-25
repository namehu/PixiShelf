import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DuplicateOperationSummary } from '../duplicate-operation-summary'
import { operation } from './duplicate-maintenance-fixtures'

afterEach(cleanup)
describe('operation result hierarchy', () => {
  it('shows the completed outcome without stale warnings or zero-value progress', () => {
    const value = operation({
      mode: 'DIRECT_DELETE',
      status: 'DELETED',
      deleteStartedAt: '2026-10-25T00:00:00Z',
      counts: {
        ...operation().counts,
        completedCopies: 1,
        remainingCopies: 0,
        deletedFiles: '2',
        remainingFiles: '0',
        deleteIntentFiles: '2'
      }
    })
    render(<DuplicateOperationSummary operation={value} />)
    expect(screen.getByRole('status').textContent).toBe('已删除 1 部重复作品，保留 1 部。')
    expect(screen.queryByText(/尚未确认删除|执行前|删除意图|尚未删除文件/)).toBeNull()
    expect(screen.queryByText('检查文件')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '处理详情' }))
    expect(screen.getByRole('dialog', { name: '处理详情' })).toBeTruthy()
    expect(screen.getByText('检查文件')).toBeTruthy()
  })
  it('keeps unfinished work visible after an interrupted deletion', () => {
    render(
      <DuplicateOperationSummary
        operation={operation({ mode: 'DIRECT_DELETE', status: 'STOPPED', deleteStartedAt: '2026-10-25T00:00:00Z' })}
      />
    )
    expect(screen.getByRole('status').textContent).toContain('尚有 1 部未完成')
    expect(screen.getByText('已删除的文件无法恢复。')).toBeTruthy()
  })
})

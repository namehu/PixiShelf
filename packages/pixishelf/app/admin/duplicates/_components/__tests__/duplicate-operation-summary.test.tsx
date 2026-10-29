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
    expect(screen.getByText('上次核对')).toBeTruthy()
  })
  it('describes quick confirmation as registered scope awaiting background verification', () => {
    const value = operation({ preparationVersion: 2, jobId: null, stage: 'CONFIRM' })
    render(<DuplicateOperationSummary operation={value} />)
    expect(screen.getByText('确认后在后台完整核对保留方和删除方的文件，通过后才开始删除。')).toBeTruthy()
    expect(screen.queryByText(/正在检查文件，完成后可确认删除/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '处理详情' }))
    expect(screen.getByText('已登记文件')).toBeTruthy()
    expect(screen.queryByText('检查文件')).toBeNull()
    expect(screen.getByText('范围确认时间')).toBeTruthy()
    expect(screen.queryByText('上次核对')).toBeNull()
  })

  it('shows actual background verification progress without presenting unknown bytes as zero', () => {
    const value = operation({
      preparationVersion: 2, mode: 'DIRECT_DELETE', status: 'VERIFYING', stage: 'FRESH',
      counts: { ...operation().counts, preparedFiles: '200', verifiedFiles: '73', logicalBytes: null }
    })
    render(<DuplicateOperationSummary operation={value} />)
    expect(screen.getByText('正在重新核对原件')).toBeTruthy()
    expect(screen.getByText('已核验 73 / 200 个已登记文件，尚未删除文件。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '处理详情' }))
    expect(screen.getByText('待核验')).toBeTruthy()
    expect(screen.queryByText('0 B')).toBeNull()
    expect(screen.getByText('已完成核验')).toBeTruthy()
  })

  it('uses only COPY files for deletion progress after verification', () => {
    render(<DuplicateOperationSummary operation={operation({
      preparationVersion: 2, mode: 'DIRECT_DELETE', status: 'DELETING', stage: 'DELETE_FILES',
      deleteStartedAt: '2026-10-29T10:00:00Z',
      counts: { ...operation().counts, preparedFiles: '200', verifiedFiles: '200', deletedFiles: '7', remainingFiles: '43' }
    })} />)
    expect(screen.getByText('正在永久删除')).toBeTruthy()
    expect(screen.getByText('已删除 7 / 50 个待删除文件。')).toBeTruthy()
    expect(screen.queryByText(/7 \/ 200/)).toBeNull()
  })

  it.each(['FAILED', 'STALE', 'STOPPED', 'RECOVERY_REQUIRED'] as const)(
    'keeps an interrupted %s verification honest before deletion starts', (status) => {
      render(<DuplicateOperationSummary operation={operation({
        preparationVersion: 2, mode: 'DIRECT_DELETE', status, deleteStartedAt: null
      })} />)
      expect(screen.getByText('处理已停止，尚未删除文件。')).toBeTruthy()
      expect(screen.queryByText('尚未删除文件，正在核对作品。')).toBeNull()
    }
  )

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

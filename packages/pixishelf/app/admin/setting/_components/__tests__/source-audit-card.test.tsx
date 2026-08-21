import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureSourceAuditRequestId,
  resolveActiveAuditPathAfterConflict,
  SourceAuditCardView
} from '../source-audit-card'

describe('SourceAuditCardView', () => {
  afterEach(cleanup)

  it('starts a read-only audit when prerequisites are ready', () => {
    const onAction = vi.fn()
    render(
      <SourceAuditCardView
        availability={{ available: true, reason: null, activeAudit: null }}
        isLoading={false}
        isRefreshing={false}
        isStarting={false}
        errorMessage={null}
        onAction={onAction}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /开始来源核对/ }))
    expect(onAction).toHaveBeenCalledOnce()
    expect(screen.getByText(/不会删除作品或覆盖现有数据/)).toBeTruthy()
  })

  it('returns to the active audit instead of presenting another start action', () => {
    const onAction = vi.fn()
    render(
      <SourceAuditCardView
        availability={{
          available: false,
          reason: 'AUDIT_ACTIVE',
          activeAudit: { auditRunId: 'audit-1', jobId: 'job-1', status: 'RUNNING' }
        }}
        isLoading={false}
        isRefreshing={false}
        isStarting={false}
        errorMessage={null}
        onAction={onAction}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /查看核对进度/ }))
    expect(onAction).toHaveBeenCalledOnce()
    expect(screen.getByText('已有核对任务正在进行')).toBeTruthy()
  })

  it('explains a missing baseline and disables the action', () => {
    render(
      <SourceAuditCardView
        availability={{ available: false, reason: 'INVENTORY_NOT_READY', activeAudit: null }}
        isLoading={false}
        isRefreshing={false}
        isStarting={false}
        errorMessage={null}
        onAction={vi.fn()}
      />
    )

    expect(screen.getByText(/完成来源基线后再核对/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /开始来源核对/ }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps the same command key when an uncertain start request is retried', () => {
    const create = vi.fn(() => 'request-1')
    const first = ensureSourceAuditRequestId(null, create)
    const retry = ensureSourceAuditRequestId(first, create)

    expect(first).toBe('request-1')
    expect(retry).toBe('request-1')
    expect(create).toHaveBeenCalledOnce()
  })

  it('recovers an active audit immediately when a concurrent start wins', async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: {
        available: false,
        reason: 'AUDIT_ACTIVE',
        activeAudit: { auditRunId: 'audit-2', jobId: 'job-2', status: 'PENDING' }
      }
    })

    await expect(resolveActiveAuditPathAfterConflict('CONFLICT', refresh)).resolves.toBe(
      '/admin/scan-history/audit-2/source-audit'
    )
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not refresh availability for unrelated start failures', async () => {
    const refresh = vi.fn()

    await expect(resolveActiveAuditPathAfterConflict('INTERNAL_SERVER_ERROR', refresh)).resolves.toBeNull()
    expect(refresh).not.toHaveBeenCalled()
  })
})

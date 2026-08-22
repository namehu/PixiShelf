import { describe, expect, it } from 'vitest'
import {
  formatAction,
  formatDate,
  formatFullDate,
  formatItemStatus,
  formatMediaCount,
  formatMode,
  formatStatus,
  getSourceMaintenanceHref,
  isSourceAuditApplyRun,
  isSourceAuditRun
} from '../scan-history-format'

describe('scan history formatting', () => {
  it('distinguishes baseline acceptance from a source change awaiting synchronization', () => {
    expect(formatAction('SKIP_EXISTING', 'BASELINE_EXISTING')).toBe('已建立基线')
    expect(formatAction('SKIP_EXISTING', 'PENDING_SOURCE_REFRESH')).toBe('发现来源变化')
    expect(formatAction('SKIP_EXISTING')).toBe('已存在')
  })

  it('distinguishes baseline rows from media processed by this run', () => {
    expect(formatMediaCount(0, 'BASELINE_EXISTING')).toBe('—')
    expect(formatMediaCount(0, null)).toBe('0')
    expect(formatMediaCount(12_345, null)).toBe('12,345')
  })

  it('renders durable queue and checkpoint states', () => {
    expect(formatStatus('PENDING')).toBe('等待执行')
    expect(formatStatus('PAUSED')).toBe('已暂停')
    expect(formatStatus('RETRY_WAIT')).toBe('等待重试')
    expect(formatItemStatus('PROCESSING')).toBe('处理中')
    expect(formatItemStatus('RETRY_WAIT')).toBe('等待重试')
  })

  it('renders a pending run without inventing a start timestamp', () => {
    expect(formatDate(null)).toBe('等待执行')
    expect(formatFullDate(null)).toBe('等待执行')
  })

  it('identifies the new read-only source audit separately from ordinary scans', () => {
    expect(formatMode('CONSISTENCY_AUDIT')).toBe('来源一致性核对')
    expect(formatMode('AUDIT_APPLY')).toBe('来源选定同步')
    expect(isSourceAuditRun({ operationKind: 'CONSISTENCY_AUDIT' })).toBe(true)
    expect(isSourceAuditApplyRun({ operationKind: 'AUDIT_APPLY' })).toBe(true)
    expect(isSourceAuditApplyRun({ operationKind: 'CONSISTENCY_AUDIT' })).toBe(false)
    expect(isSourceAuditRun({ operationKind: 'SCAN' })).toBe(false)
  })

  it('deep-links source apply history back to its audit and selected operation', () => {
    expect(
      getSourceMaintenanceHref({
        id: 'apply-1',
        operationKind: 'AUDIT_APPLY',
        sourceAuditRunId: 'audit-1'
      })
    ).toBe('/admin/scan-history/audit-1/source-audit?operation=apply-1')
    expect(getSourceMaintenanceHref({ id: 'audit-1', operationKind: 'CONSISTENCY_AUDIT' })).toBe(
      '/admin/scan-history/audit-1/source-audit'
    )
    expect(getSourceMaintenanceHref({ id: 'apply-1', operationKind: 'AUDIT_APPLY', sourceAuditRunId: null })).toBeNull()
  })
})

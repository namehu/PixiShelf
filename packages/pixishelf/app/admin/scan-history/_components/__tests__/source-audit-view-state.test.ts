import { describe, expect, it, vi } from 'vitest'
import {
  countSourceAuditSelection,
  formatSourceAuditApplyItemState,
  formatSourceAuditApplyStage,
  formatSourceAuditStatus,
  getOrCreateSourceAuditApplyKey,
  getSourceAuditClassificationMeta,
  getSourceAuditCount,
  getSourceAuditApplyResultCopy,
  getSourceAuditApplyBlockedCopy,
  getSourceAuditReasonCopy,
  reconcileSourceAuditSelection,
  resolveSourceAuditApplyOperationId,
  releaseSourceAuditApplyKey,
  sourceAuditApplyPayloadFingerprint,
  sourceAuditCurrentPageSelectionState,
  shouldPollSourceAudit
} from '../source-audit-view-state'

describe('source audit view state', () => {
  it('maps every difference to the matching summary counter', () => {
    const counts = { new: 1, changed: 2, missing: 3, invalid: 4, identityConflict: 5, unchanged: 6 }

    expect(getSourceAuditCount(counts, 'NEW')).toBe(1)
    expect(getSourceAuditCount(counts, 'IDENTITY_CONFLICT')).toBe(5)
    expect(getSourceAuditCount(counts, 'UNCHANGED')).toBe(6)
    expect(getSourceAuditClassificationMeta('MISSING').label).toBe('来源缺失')
  })

  it('polls recoverable in-flight states but stops after terminal states', () => {
    expect(shouldPollSourceAudit(undefined)).toBe(true)
    expect(shouldPollSourceAudit('RUNNING')).toBe(true)
    expect(shouldPollSourceAudit('PAUSED')).toBe(true)
    expect(shouldPollSourceAudit('COMPLETED')).toBe(false)
    expect(shouldPollSourceAudit('FAILED')).toBe(false)
    expect(shouldPollSourceAudit('CANCELLED')).toBe(false)
  })

  it('uses actionable copy without exposing an internal exception', () => {
    expect(formatSourceAuditStatus('RETRY_WAIT')).toBe('等待重试')
    expect(getSourceAuditReasonCopy('SOURCE_CHANGED')).toEqual({
      title: '核对期间来源目录发生了变化',
      description: '本次结果未被作为完整快照，请等待文件变动结束后重新核对。'
    })
  })

  it('limits selection to eligible items from the current loaded page', () => {
    const selected = new Set(['new-1', 'changed-1', 'old-page'])

    expect([...reconcileSourceAuditSelection(selected, ['new-1', 'changed-1'])]).toEqual(['new-1', 'changed-1'])
    expect(sourceAuditCurrentPageSelectionState(new Set(['new-1']), ['new-1', 'changed-1'])).toEqual({
      selectedCount: 1,
      checked: 'indeterminate'
    })
    expect(
      countSourceAuditSelection(
        [
          { id: 'new-1', classification: 'NEW' },
          { id: 'changed-1', classification: 'CHANGED' },
          { id: 'missing-1', classification: 'MISSING' }
        ],
        new Set(['new-1', 'changed-1'])
      )
    ).toEqual({ total: 2, new: 1, changed: 1 })
  })

  it('keeps an uncertain mixed apply command key stable across selection order', () => {
    const keys = new Map<string, string>()
    const createKey = vi.fn(() => 'command-1')

    expect(sourceAuditApplyPayloadFingerprint('audit-1', ['changed', 'new', 'new'])).toBe('audit-1:changed,new')
    expect(getOrCreateSourceAuditApplyKey(keys, 'audit-1', ['new', 'changed'], createKey)).toBe('command-1')
    expect(getOrCreateSourceAuditApplyKey(keys, 'audit-1', ['changed', 'new'], createKey)).toBe('command-1')
    expect(createKey).toHaveBeenCalledOnce()

    releaseSourceAuditApplyKey(keys, 'audit-1', ['new', 'changed'])
    expect(getOrCreateSourceAuditApplyKey(keys, 'audit-1', ['new', 'changed'], () => 'command-2')).toBe('command-2')
  })

  it('uses safe guidance for stale, conflicting, and failed item results', () => {
    expect(getSourceAuditApplyResultCopy('STALE')).toMatch(/重新运行来源核对/)
    expect(getSourceAuditApplyResultCopy('CONFLICT')).toMatch(/没有写入/)
    expect(getSourceAuditApplyResultCopy('FAILED')).not.toMatch(/exception|stack|路径/)
  })

  it('maps operation stages, item states, and blocked outcomes to user-facing copy', () => {
    expect(formatSourceAuditApplyStage('VERIFYING')).toBe('重新核验来源')
    expect(formatSourceAuditApplyStage('CANCELLED')).toBe('同步已取消')
    expect(formatSourceAuditApplyItemState('PROCESSING', 'IMPORT')).toBe('正在导入')
    expect(formatSourceAuditApplyItemState('APPLIED', 'SYNC')).toBe('已同步')
    expect(getSourceAuditApplyBlockedCopy('ITEMS_NOT_ELIGIBLE')).toMatch(/刷新当前页/)
    expect(getSourceAuditApplyBlockedCopy('SOURCE_ROOT_UNAVAILABLE')).toMatch(/挂载/)
  })

  it('honors an explicit operation deep link before active and latest recovery', () => {
    expect(resolveSourceAuditApplyOperationId('explicit', 'active', 'latest')).toBe('explicit')
    expect(resolveSourceAuditApplyOperationId(null, 'active', 'latest')).toBe('active')
    expect(resolveSourceAuditApplyOperationId(null, null, 'latest')).toBe('latest')
    expect(resolveSourceAuditApplyOperationId(null, null, null)).toBeNull()
  })
})

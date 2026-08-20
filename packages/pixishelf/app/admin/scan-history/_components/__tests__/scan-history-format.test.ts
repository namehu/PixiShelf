import { describe, expect, it } from 'vitest'
import {
  formatAction,
  formatDate,
  formatFullDate,
  formatItemStatus,
  formatMediaCount,
  formatStatus
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
})

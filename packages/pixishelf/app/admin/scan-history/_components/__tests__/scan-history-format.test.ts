import { describe, expect, it } from 'vitest'
import { formatDate, formatFullDate, formatItemStatus, formatStatus } from '../scan-history-format'

describe('scan history formatting', () => {
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

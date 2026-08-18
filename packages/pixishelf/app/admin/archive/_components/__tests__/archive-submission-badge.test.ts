import { describe, expect, it } from 'vitest'
import { shortArchiveSubmissionId } from '../archive-submission-badge'

describe('archive submission badge', () => {
  it('keeps short ids intact and abbreviates longer ids consistently', () => {
    expect(shortArchiveSubmissionId('short-id')).toBe('short-id')
    expect(shortArchiveSubmissionId('submission-123456789')).toBe('submissi…')
  })
})

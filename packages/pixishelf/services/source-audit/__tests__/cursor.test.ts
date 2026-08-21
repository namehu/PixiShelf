import { describe, expect, it } from 'vitest'
import { decodeSourceAuditCursor, encodeSourceAuditCursor } from '../cursor'

describe('source audit cursor', () => {
  it('round trips a stable ordinal/id cursor', () => {
    const encoded = encodeSourceAuditCursor({
      version: 1,
      auditRunId: 'audit-run-1',
      classification: 'CHANGED',
      ordinal: 42,
      id: 'audit-item-42'
    })
    expect(decodeSourceAuditCursor(encoded)).toEqual({
      version: 1,
      auditRunId: 'audit-run-1',
      classification: 'CHANGED',
      ordinal: 42,
      id: 'audit-item-42'
    })
  })

  it.each(['not+base64', 'e30', 'eyJ2ZXJzaW9uIjoyLCJvcmRpbmFsIjoxLCJpZCI6IngifQ'])(
    'rejects an invalid or incompatible cursor: %s',
    (cursor) => {
      expect(() => decodeSourceAuditCursor(cursor)).toThrow('Invalid source audit cursor')
    }
  )
})

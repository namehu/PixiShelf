import { describe, expect, it } from 'vitest'
import { ScanExecutorError } from '../errors.ts'
import {
  classifyInventoryFailure,
  decideInventoryBeforeHash,
  hashScanRootIdentity,
  isKnownPermanentContent,
  shouldProcessHashedInventory,
  type PixivInventoryRecord
} from '../inventory.ts'

const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const state = { sizeBytes: 10n, mtimeMs: 20n, ctimeMs: 30n, deviceId: 40n, inode: 50n }

function inventory(overrides: Partial<PixivInventoryRecord> = {}): PixivInventoryRecord {
  return {
    id: 'inventory-1',
    relativePath: '42/42-meta.json',
    externalId: '42',
    ...state,
    observedContentHash: hashA,
    processedContentHash: hashA,
    lastAttemptedContentHash: hashA,
    externalRefId: null,
    baselineGeneration: 1,
    baselineEligible: false,
    lastSeenScanRunId: null,
    lastAttemptedAt: null,
    lastProcessedAt: null,
    lastErrorCode: null,
    lastErrorSummary: null,
    lastErrorRetryable: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides
  }
}

describe('pixiv metadata inventory decisions', () => {
  it('uses a deterministic root identity without storing the root path', () => {
    expect(hashScanRootIdentity('/data/pixiv')).toMatch(/^[a-f0-9]{64}$/)
    expect(hashScanRootIdentity('/data/pixiv')).toBe(hashScanRootIdentity('/data/pixiv'))
    expect(hashScanRootIdentity('/data/pixiv')).not.toBe(hashScanRootIdentity('/data/other'))
  })

  it('skips a stable processed input without hashing', () => {
    expect(decideInventoryBeforeHash(inventory(), state)).toEqual({ kind: 'UNCHANGED' })
  })

  it('uses ctime and file identity when the filesystem provides them', () => {
    expect(decideInventoryBeforeHash(inventory(), { ...state, inode: 51n })).toEqual({ kind: 'HASH' })
    expect(decideInventoryBeforeHash(inventory({ inode: null }), { ...state, inode: 51n })).toEqual({
      kind: 'UNCHANGED'
    })
  })

  it('reprocesses a retryable failure without rehashing stable content', () => {
    expect(decideInventoryBeforeHash(inventory({ lastErrorRetryable: true }), state)).toEqual({
      kind: 'PROCESS_STORED_HASH',
      contentHash: hashA
    })
  })

  it('does not lose observed content when discovery restarts before the first attempt', () => {
    expect(
      decideInventoryBeforeHash(
        inventory({ processedContentHash: null, lastAttemptedContentHash: null, lastErrorRetryable: null }),
        state
      )
    ).toEqual({ kind: 'PROCESS_STORED_HASH', contentHash: hashA })
  })

  it('does not apply an old permanent failure to newly observed content', () => {
    expect(
      decideInventoryBeforeHash(
        inventory({
          observedContentHash: hashB,
          processedContentHash: null,
          lastAttemptedContentHash: hashA,
          lastErrorCode: 'METADATA_INVALID',
          lastErrorSummary: 'old content was invalid',
          lastErrorRetryable: false
        }),
        state
      )
    ).toEqual({ kind: 'PROCESS_STORED_HASH', contentHash: hashB })
  })

  it('does not repeatedly parse the same pending or permanent content', () => {
    expect(
      shouldProcessHashedInventory(
        inventory({ processedContentHash: null, lastAttemptedContentHash: hashB, lastErrorRetryable: false }),
        hashB
      )
    ).toBe(false)
    expect(
      shouldProcessHashedInventory(
        inventory({ processedContentHash: hashA, lastAttemptedContentHash: hashB, lastErrorRetryable: null }),
        hashB
      )
    ).toBe(false)
  })

  it('reevaluates a terminal external-state failure in a later run without rehashing', () => {
    const conflicted = inventory({
      processedContentHash: null,
      lastErrorCode: 'STATE_CONFLICT',
      lastErrorSummary: 'Artwork source changed',
      lastErrorRetryable: null
    })
    expect(decideInventoryBeforeHash(conflicted, state)).toEqual({
      kind: 'PROCESS_STORED_HASH',
      contentHash: hashA
    })
    expect(shouldProcessHashedInventory(conflicted, hashA)).toBe(true)
  })

  it('replays stable unprocessed content while the trusted baseline is still initializing', () => {
    const pending = inventory({ processedContentHash: null, lastAttemptedContentHash: hashA })
    expect(decideInventoryBeforeHash(pending, state)).toEqual({ kind: 'UNCHANGED' })
    expect(decideInventoryBeforeHash(pending, state, true)).toEqual({
      kind: 'PROCESS_STORED_HASH',
      contentHash: hashA
    })
  })

  it('carries a stable permanent failure into the next run without rehashing', () => {
    const failed = inventory({
      lastErrorCode: 'METADATA_INVALID',
      lastErrorSummary: 'Metadata document is invalid',
      lastErrorRetryable: false
    })
    expect(decideInventoryBeforeHash(failed, state)).toEqual({
      kind: 'KNOWN_FAILURE',
      contentHash: hashA,
      code: 'METADATA_INVALID',
      summary: 'Metadata document is invalid'
    })
    expect(isKnownPermanentContent(failed, hashA)).toBe(true)
  })

  it('never caches a pre-hash nonretryable failure as content-deterministic', () => {
    expect(
      decideInventoryBeforeHash(
        inventory({
          observedContentHash: null,
          processedContentHash: null,
          lastAttemptedContentHash: null,
          lastErrorCode: 'SYMLINK_NOT_ALLOWED',
          lastErrorSummary: 'Input became a symlink',
          lastErrorRetryable: false
        }),
        state
      )
    ).toEqual({ kind: 'HASH' })
  })

  it('processes new content and same-content retryable failures', () => {
    expect(shouldProcessHashedInventory(undefined, hashA)).toBe(true)
    expect(shouldProcessHashedInventory(inventory(), hashB)).toBe(true)
    expect(
      shouldProcessHashedInventory(
        inventory({ processedContentHash: null, lastAttemptedContentHash: hashA, lastErrorRetryable: true }),
        hashA
      )
    ).toBe(true)
  })

  it('keeps invalid metadata permanent while retrying filesystem and media failures', () => {
    expect(classifyInventoryFailure(new ScanExecutorError('METADATA_INVALID', 'invalid'))).toMatchObject({
      code: 'METADATA_INVALID',
      retryable: false,
      contentDeterministic: true
    })
    expect(classifyInventoryFailure(new ScanExecutorError('MEDIA_NOT_FOUND', 'missing'))).toMatchObject({
      code: 'MEDIA_NOT_FOUND',
      retryable: true,
      contentDeterministic: false
    })
    expect(classifyInventoryFailure(new Error('database details'))).toEqual({
      code: 'UNEXPECTED',
      summary: 'Metadata input could not be processed',
      retryable: true,
      contentDeterministic: false
    })
  })
})

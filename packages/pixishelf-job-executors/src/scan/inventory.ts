import { createHash } from 'node:crypto'
import type { Prisma } from '@pixishelf/db'
import type { StableFileState } from './content-reader.ts'
import { ScanExecutorError } from './errors.ts'

const SHA256_PATTERN = /^[a-f0-9]{64}$/

export type PixivInventoryRecord = Prisma.PixivMetadataInventoryGetPayload<Record<string, never>>

export type InventoryPreHashDecision =
  | { kind: 'HASH' }
  | { kind: 'PROCESS_STORED_HASH'; contentHash: string }
  | { kind: 'KNOWN_FAILURE'; contentHash: string | null; code: string; summary: string }
  | { kind: 'UNCHANGED' }

export function hashScanRootIdentity(absolutePath: string): string {
  return createHash('sha256').update(absolutePath).digest('hex')
}

// This decision tree deliberately separates observing bytes from publishing them. Stable
// unprocessed hashes can be replayed without I/O, while a permanent verdict is reusable only
// when lastAttemptedContentHash proves that it describes the currently observed content.
export function decideInventoryBeforeHash(
  inventory: PixivInventoryRecord | undefined,
  state: StableFileState,
  initializingBaseline = false
): InventoryPreHashDecision {
  if (!inventory || !sameInventoryState(inventory, state)) return { kind: 'HASH' }
  if (
    inventory.lastErrorRetryable === false &&
    isContentHash(inventory.lastAttemptedContentHash) &&
    inventory.lastAttemptedContentHash === inventory.observedContentHash &&
    inventory.lastErrorCode &&
    inventory.lastErrorSummary
  ) {
    return {
      kind: 'KNOWN_FAILURE',
      contentHash: inventory.lastAttemptedContentHash,
      code: inventory.lastErrorCode,
      summary: inventory.lastErrorSummary
    }
  }
  if (inventory.lastErrorRetryable === true && isContentHash(inventory.observedContentHash)) {
    return { kind: 'PROCESS_STORED_HASH', contentHash: inventory.observedContentHash }
  }
  if (inventory.lastErrorRetryable === true && inventory.observedContentHash === null) return { kind: 'HASH' }
  if (
    inventory.lastErrorRetryable === null &&
    inventory.lastErrorCode &&
    isContentHash(inventory.observedContentHash) &&
    inventory.processedContentHash !== inventory.observedContentHash
  ) {
    return { kind: 'PROCESS_STORED_HASH', contentHash: inventory.observedContentHash }
  }
  if (
    initializingBaseline &&
    isContentHash(inventory.observedContentHash) &&
    inventory.processedContentHash !== inventory.observedContentHash
  ) {
    return { kind: 'PROCESS_STORED_HASH', contentHash: inventory.observedContentHash }
  }
  if (
    isContentHash(inventory.observedContentHash) &&
    inventory.processedContentHash !== inventory.observedContentHash &&
    inventory.lastAttemptedContentHash !== inventory.observedContentHash
  ) {
    return { kind: 'PROCESS_STORED_HASH', contentHash: inventory.observedContentHash }
  }
  if (inventory.observedContentHash === null) return { kind: 'HASH' }
  return { kind: 'UNCHANGED' }
}

export function isKnownPermanentContent(inventory: PixivInventoryRecord | undefined, contentHash: string): boolean {
  return (
    inventory?.lastErrorRetryable === false &&
    inventory.lastAttemptedContentHash === contentHash &&
    Boolean(inventory.lastErrorCode && inventory.lastErrorSummary)
  )
}

export function shouldProcessHashedInventory(
  inventory: PixivInventoryRecord | undefined,
  contentHash: string
): boolean {
  if (!inventory) return true
  if (inventory.processedContentHash === contentHash) return false
  if (inventory.lastAttemptedContentHash !== contentHash) return true
  if (inventory.lastErrorRetryable === null && inventory.lastErrorCode) return true
  return inventory.lastErrorRetryable === true
}

export function sameInventoryState(inventory: PixivInventoryRecord, state: StableFileState): boolean {
  if (inventory.sizeBytes !== state.sizeBytes || inventory.mtimeMs !== state.mtimeMs) return false
  return (
    sameOptionalSignal(inventory.ctimeMs, state.ctimeMs) &&
    sameOptionalSignal(inventory.deviceId, state.deviceId) &&
    sameOptionalSignal(inventory.inode, state.inode)
  )
}

export function inventoryStatData(state: StableFileState) {
  return {
    sizeBytes: state.sizeBytes,
    mtimeMs: state.mtimeMs,
    ctimeMs: state.ctimeMs,
    deviceId: state.deviceId,
    inode: state.inode
  }
}

export function classifyInventoryFailure(error: unknown): {
  code: string
  summary: string
  retryable: boolean
  contentDeterministic: boolean
} {
  if (error instanceof ScanExecutorError) {
    return {
      code: error.code,
      summary: error.message,
      contentDeterministic: error.code === 'METADATA_INVALID',
      retryable:
        error.recoverable ||
        error.code === 'SOURCE_NOT_FOUND' ||
        error.code === 'SOURCE_NOT_READABLE' ||
        error.code === 'MEDIA_NOT_FOUND' ||
        error.code === 'INPUT_SNAPSHOT_INVALID'
    }
  }
  return {
    code: 'UNEXPECTED',
    summary: 'Metadata input could not be processed',
    retryable: true,
    contentDeterministic: false
  }
}

function sameOptionalSignal(left: bigint | null, right: bigint | null): boolean {
  // Optional filesystem identity fields strengthen change detection only when both observations
  // provide them; missing support must not make every scan look changed.
  return left === null || right === null || left === right
}

function isContentHash(value: string | null): value is string {
  return value !== null && SHA256_PATTERN.test(value)
}

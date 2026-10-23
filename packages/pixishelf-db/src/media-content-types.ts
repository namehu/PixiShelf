import type { Prisma } from '@prisma/client'

export type MediaContentTransaction = Prisma.TransactionClient
export type MediaContentLogicalRoot = 'source-media:v1' | 'archive-media:v1'
export interface MediaContentRootBinding {
  logicalRoot: MediaContentLogicalRoot
  rootIdentity: string
}
export interface MediaContentDirectoryKey extends MediaContentRootBinding {
  relativeDirectory: string
}
export interface MediaContentDirectorySnapshot extends MediaContentDirectoryKey {
  directoryId: string
  generation: bigint
}
export interface ArtworkContentSnapshot {
  artworkId: number
  revision: bigint
  mediaEpoch: bigint
  memberCount: bigint
}
export interface MediaContentFileState {
  size: bigint
  mtimeNs: bigint | null
  ctimeNs: bigint | null
  deviceId: bigint | null
  inode: bigint | null
}
export interface MediaContentFileFingerprint extends MediaContentFileState {
  imageId: number
  algorithmVersion: number
  rootIdentity: string
  sourcePath: string
  canonicalPath: string
  sourceRevision: bigint
  artworkMediaEpoch: bigint
  sha256: string
  hashedAt: Date
}
export interface MediaContentMember {
  imageId: number
  artworkId: number
  sourcePath: string
  sourceRevision: bigint
  writeToken: string | null
  directory: MediaContentDirectorySnapshot | null
  fingerprint: MediaContentFileFingerprint | null
}
export type MediaContentRejection = { status: 'MISSING' | 'STALE' | 'WRITING' | 'ROOT_CHANGED' | 'INCOMPLETE' }
export type MediaContentResult<T> = { status: 'READY'; value: T } | MediaContentRejection
export interface MediaContentObservation {
  imageId: number
  expectedSourcePath: string
  expectedSourceRevision: bigint
  directory: MediaContentDirectorySnapshot
  canonicalPath: string
  state: MediaContentFileState
  sha256?: string
}
export interface MediaContentReadEvidence extends MediaContentObservation {
  sha256: string
  hashedAt: Date
}
export interface MediaContentFingerprintCursor {
  size: bigint
  sha256: string
  imageId: number
}
export interface MediaContentOwner {
  ownerUserId: string | null
  sessionId: string
  sessionVersion: bigint
  execution: null | { jobId: string; executionToken: string; executionAttempt: number }
}
export type MediaContentWriteScope = { kind: 'PATH'; relativePath: string } | { kind: 'DIRECTORY' }
export interface MediaContentWriteHandle {
  writeId: string
  directoryId: string
  writeToken: string
  declarationVersion: bigint
  scope: MediaContentWriteScope
  parentWriteId: string | null
}
export interface MediaContentChunkReceipt {
  requestId: string
  chunkIndex: number
  offset: bigint
  byteLength: bigint
  sha256: string
}
export interface MediaContentUploadCheckpoint {
  handle: MediaContentWriteHandle
  status: 'ACTIVE' | 'READY' | 'RECOVERY_REQUIRED' | 'COMPLETED' | 'ROLLED_BACK'
  declaredFileSize: bigint
  totalChunks: number
  nextChunkIndex: number
  committedBytes: bigint
  lastReceipt: MediaContentChunkReceipt | null
}
export interface MediaContentSourceWriteToken {
  writeToken: string
  artworkIds: number[]
  imageIds: number[]
}
export type MediaContentChildResolution =
  | { kind: 'PUBLISH'; receipt: MediaContentChunkReceipt }
  | { kind: 'VERIFIED_ROLLBACK'; disposition: 'RESTORED' | 'REMOVED' | 'ISOLATED'; evidenceId: string }

export class MediaContentConflictError extends Error {
  constructor(
    public readonly status: MediaContentRejection['status'],
    message = status
  ) {
    super(message)
    this.name = 'MediaContentConflictError'
  }
}

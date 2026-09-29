import type { StableFileState } from './content-reader.ts'

interface StoredAnimationSource {
  writeInProgress: boolean
  sourcePath: string | null
  sourceSize: bigint | null
  sourceMtimeMs: bigint | null
  sourceCtimeMs: bigint | null
  sourceDeviceId: bigint | null
  sourceInode: bigint | null
  status: string
}

/** Discovery already lstat-ed the file; compare that evidence without another NFS walk. */
export function animationDurationSourceChanged(input: {
  previousPath: string
  previousSize: bigint | null
  path: string
  size: bigint
  sourceState?: StableFileState
  metadata: StoredAnimationSource | null
}) {
  const { metadata } = input
  if (!metadata) return false
  if (metadata.writeInProgress) return false
  if (input.previousPath !== input.path || metadata.sourcePath !== input.path) return true
  if (input.previousSize !== input.size) return true
  if (!input.sourceState) return false
  if (metadata.sourceSize !== null && metadata.sourceSize !== input.sourceState.sizeBytes) return true
  if (metadata.sourceMtimeMs !== null && metadata.sourceMtimeMs !== input.sourceState.mtimeMs) return true
  if (metadata.sourceCtimeMs !== null && metadata.sourceCtimeMs !== input.sourceState.ctimeMs) return true
  if (metadata.sourceDeviceId !== null && metadata.sourceDeviceId !== input.sourceState.deviceId) return true
  if (metadata.sourceInode !== null && metadata.sourceInode !== input.sourceState.inode) return true
  return (
    (metadata.status === 'READY' || metadata.status === 'NOT_APPLICABLE') &&
    (metadata.sourceSize === null || metadata.sourceMtimeMs === null)
  )
}

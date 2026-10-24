import type { MaintenanceSourceIdentity, MaintenanceSourceResult } from './maintenance-source.ts'
import type {
  DirectDeleteFileReceipt,
  MaintenanceInspection,
  MaintenanceDirectoryPage,
  MaintenanceFileState,
  MaintenanceFilesystemCapability
} from './maintenance-files.ts'
import type { ContentFileInspection } from '../media-content/file-reader.ts'
import type { ResolvedMediaContentRoot, resolveMediaContentRoots } from '../media-content/roots.ts'

export type DedupRoots = Awaited<ReturnType<typeof resolveMediaContentRoots>>
export type DedupRead = ContentFileInspection & { sha256: string; hashedAt: Date; bytesRead: bigint }
export type ReaderOperation =
  | { operation: 'roots'; sourceRoot: string; archiveRoot: string; expectedPixivRootIdentity: string | null }
  | { operation: 'inspect' | 'read' | 'maintenance-inspect'; root: ResolvedMediaContentRoot; relativePath: string }
  | {
      operation: 'maintenance-directory'
      root: ResolvedMediaContentRoot
      relativePath: string
      afterName: string | null
      expectedState: MaintenanceFileState | null
    }
  | {
      operation: 'maintenance-source'
      root: ResolvedMediaContentRoot
      relativePath: string
      expectedIdentity: MaintenanceSourceIdentity
      offset: number
    }
  | { operation: 'direct-delete'; root: ResolvedMediaContentRoot; relativePath: string; expectedState: MaintenanceFileState; allowMissing: boolean }
  | { operation: 'maintenance-capability'; root: ResolvedMediaContentRoot; operationId: string }
export type ReaderRequest = ReaderOperation & { id: number; type: 'request' }
export type ReaderResponse =
  | { type: 'progress'; id: number; bytesRead: bigint; rss: number }
  | {
      type: 'result'
      id: number
      value:
        | DirectDeleteFileReceipt
        | DedupRoots
        | ContentFileInspection
        | DedupRead
        | MaintenanceSourceResult
        | MaintenanceInspection
        | MaintenanceDirectoryPage
        | MaintenanceFilesystemCapability
      rss: number
    }
  | { type: 'error'; id: number; code: string; bytesRead: bigint; rss: number }

export function isExclusiveReaderOperation(operation: ReaderOperation['operation']) {
  return (
    operation === 'direct-delete' ||
    operation === 'roots' ||
    operation === 'maintenance-directory' ||
    operation === 'maintenance-capability' ||
    operation === 'maintenance-source'
  )
}

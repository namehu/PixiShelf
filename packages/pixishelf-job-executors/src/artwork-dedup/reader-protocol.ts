import type { ContentFileInspection } from '../media-content/file-reader.ts'
import type { ResolvedMediaContentRoot, resolveMediaContentRoots } from '../media-content/roots.ts'

export type DedupRoots = Awaited<ReturnType<typeof resolveMediaContentRoots>>
export type DedupRead = ContentFileInspection & { sha256: string; hashedAt: Date; bytesRead: bigint }
export type ReaderOperation =
  | { operation: 'roots'; sourceRoot: string; archiveRoot: string; expectedPixivRootIdentity: string | null }
  | { operation: 'inspect' | 'read'; root: ResolvedMediaContentRoot; relativePath: string }
export type ReaderRequest = ReaderOperation & { id: number; type: 'request' }
export type ReaderResponse =
  | { type: 'progress'; id: number; bytesRead: bigint; rss: number }
  | { type: 'result'; id: number; value: DedupRoots | ContentFileInspection | DedupRead; rss: number }
  | { type: 'error'; id: number; code: string; rss: number }

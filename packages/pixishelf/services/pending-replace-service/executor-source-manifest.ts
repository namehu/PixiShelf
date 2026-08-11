import 'server-only'
import fs from 'fs/promises'
import path from 'path'
import { MEDIA_EXTENSIONS } from '@/lib/constant'
import {
  PENDING_REPLACE_MANIFEST_FILE,
  type PendingReplaceManifestFile
} from '@/schemas/pending-replace.dto'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { createFileSha256 } from './executor-file-utils'

const supportedMediaExtensions = new Set(MEDIA_EXTENSIONS)

export async function readMovedSourceManifest(
  directory: string,
  expected: PendingReplaceManifestFile[]
): Promise<PendingReplaceManifestFile[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const expectedKindByName = new Map(expected.map((file) => [file.name, file.kind]))
  const manifest: PendingReplaceManifestFile[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isSymbolicLink()) throw new Error(`工作区中不允许符号链接: ${entry.name}`)
    if (!entry.isFile()) continue
    if (entry.name.toLowerCase() === PENDING_REPLACE_MANIFEST_FILE) {
      throw new Error(`${PENDING_REPLACE_MANIFEST_FILE} 是系统保留文件名`)
    }
    const filePath = path.join(directory, entry.name)
    const stats = await fs.stat(filePath)
    const extension = path.extname(entry.name).toLowerCase()
    manifest.push({
      name: entry.name,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: await createFileSha256(filePath),
      kind:
        expectedKindByName.get(entry.name) ??
        (supportedMediaExtensions.has(extension)
          ? 'media'
          : isChapterManifestFileName(entry.name)
            ? 'chapter'
            : 'ignored')
    })
  }
  return manifest
}

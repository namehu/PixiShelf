import fs from 'fs/promises'
import path from 'path'
import {
  PENDING_REPLACE_MANIFEST_FILE,
  type PendingReplaceManifestFile
} from '@/schemas/pending-replace.dto'
import { pathExists, removeEmptyDirectory } from './executor-file-utils'

export async function archiveSuccessfulReplacement(input: {
  item: {
    id: string
    batchId: string
    artworkId: number | null
    externalId: string | null
    sourceDirectoryName: string
  }
  manifest: PendingReplaceManifestFile[]
  workAbsolute: string
  workSourceAbsolute: string
  normalizedAbsolute: string
  completedAbsolute: string
}) {
  if (await pathExists(input.workSourceAbsolute)) {
    if (await pathExists(input.completedAbsolute)) {
      throw new Error(`完成归档目录已存在: ${input.completedAbsolute}`)
    }
    await fs.mkdir(path.dirname(input.completedAbsolute), { recursive: true })
    await fs.writeFile(
      path.join(input.workSourceAbsolute, PENDING_REPLACE_MANIFEST_FILE),
      JSON.stringify(
        {
          batchId: input.item.batchId,
          itemId: input.item.id,
          artworkId: input.item.artworkId,
          externalId: input.item.externalId,
          originalDirectory: input.item.sourceDirectoryName,
          files: input.manifest,
          completedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    )
    await fs.rename(input.workSourceAbsolute, input.completedAbsolute)
  } else if (!(await pathExists(input.completedAbsolute))) {
    throw new Error('替换已提交，但工作目录和完成归档均不存在')
  }
  await removeEmptyDirectory(input.normalizedAbsolute)
  await removeEmptyDirectory(input.workAbsolute)
}

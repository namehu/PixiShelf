import type { ArchiveTransaction } from './types.ts'
import { ArchiveExecutorError } from './errors.ts'

// Old failed imports cannot resurrect an intentionally deleted identity through retry.
export async function assertArchiveImportNotDeleted(
  transaction: ArchiveTransaction,
  archiveImport: { providerKey: string; externalId: string; createdAt: Date }
) {
  const deletion = await transaction.archiveDeletedIdentity.findUnique({
    where: { providerKey_externalId: { providerKey: archiveImport.providerKey, externalId: archiveImport.externalId } }
  })
  if (deletion && (!deletion.purgedAt || archiveImport.createdAt <= deletion.purgedAt)) {
    throw new ArchiveExecutorError('STATE_CONFLICT', '该作品已删除，文件清理完成后请手动重新提交归档')
  }
}

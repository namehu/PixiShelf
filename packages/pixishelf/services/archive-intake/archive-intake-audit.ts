import type { Prisma } from '@pixishelf/db'

export const replacementFieldsSelect = {
  localCreatorsOnly: true,
  assignedArtistIds: true,
  creatorSourceId: true,
  creatorSourceName: true,
  completionBaseRevisionId: true,
  completionSnapshot: true,
  upgradeBaseRevisionId: true,
  upgradeSnapshot: true
} as const

export type ReplacementFields = Pick<Prisma.ArchiveIntakeItemCreateManyInput, keyof typeof replacementFieldsSelect>

export async function createDuplicateAuditItem(
  transaction: Prisma.TransactionClient,
  input: {
    id: string
    submissionId: string
    submittedUrl: string
    normalizedUrlHash: string
    duplicateOfItemId: string
    supersedesItemId?: string
    downloadMode: 'AUTO' | 'MANUAL'
    quality: 'ORIGINAL' | 'DISPLAY'
    downloadScope: 'ALL' | 'FIRST_20'
    timestamp: Date
  }
) {
  return transaction.archiveIntakeItem.create({
    data: {
      id: input.id,
      submissionId: input.submissionId,
      submittedUrl: input.submittedUrl,
      normalizedUrlHash: input.normalizedUrlHash,
      downloadMode: input.downloadMode,
      selectedQuality: input.quality,
      downloadScope: input.downloadScope,
      status: 'DUPLICATE',
      duplicateOfItemId: input.duplicateOfItemId,
      supersedesItemId: input.supersedesItemId,
      finishedAt: input.timestamp,
      retryable: false,
      createdAt: input.timestamp,
      updatedAt: input.timestamp
    }
  })
}

export async function createCapacityRejectedAuditItem(
  transaction: Prisma.TransactionClient,
  input: {
    replacementFields: ReplacementFields
    id: string
    submissionId: string
    submittedUrl: string
    normalizedUrlHash: string
    supersedesItemId: string
    downloadMode: 'AUTO' | 'MANUAL'
    quality: 'ORIGINAL' | 'DISPLAY'
    downloadScope: 'ALL' | 'FIRST_20'
    timestamp: Date
  }
) {
  return transaction.archiveIntakeItem.create({
    data: {
      ...input.replacementFields,
      id: input.id,
      submissionId: input.submissionId,
      submittedUrl: input.submittedUrl,
      normalizedUrlHash: input.normalizedUrlHash,
      downloadMode: input.downloadMode,
      selectedQuality: input.quality,
      downloadScope: input.downloadScope,
      status: 'FAILED',
      supersedesItemId: input.supersedesItemId,
      finishedAt: input.timestamp,
      errorCode: 'CAPACITY_EXCEEDED',
      errorMessage: '归档收件箱活动项目已达上限；释放容量后可重试',
      retryable: false,
      createdAt: input.timestamp,
      updatedAt: input.timestamp
    }
  })
}

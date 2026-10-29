import type { Prisma } from '@pixishelf/db'

export const intakeItemWireSelect = {
  id: true,
  submissionId: true,
  submittedUrl: true,
  queueOrder: true,
  status: true,
  attempts: true,
  availableAt: true,
  startedAt: true,
  finishedAt: true,
  providerKey: true,
  externalId: true,
  canonicalUrl: true,
  resolvedTitle: true,
  thumbnailUrl: true,
  pageCount: true,
  resolutionKind: true,
  duplicateOfItemId: true,
  activeArchiveImportId: true,
  selectedQuality: true,
  downloadMode: true,
  downloadScope: true,
  resolvedAt: true,
  expiresAt: true,
  archiveImportId: true,
  errorCode: true,
  errorMessage: true,
  errorStage: true,
  retryable: true,
  supersedesItemId: true,
  currentSystemJobId: true,
  dedupSourceSnapshot: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ArchiveIntakeItemSelect

export type IntakeItemWire = Prisma.ArchiveIntakeItemGetPayload<{ select: typeof intakeItemWireSelect }>

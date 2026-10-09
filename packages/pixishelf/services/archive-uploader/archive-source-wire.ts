import type { Prisma } from '@pixishelf/db'
import { archiveTitleQuerySchema } from '@pixishelf/job-contracts'
import { archiveWireErrorMessage } from '@/services/archive/archive-redaction'

export const sourceWireSelect = {
  defaultCreators: {
    select: { artist: { select: { id: true, name: true, kind: true } } },
    orderBy: { artistId: 'asc' }
  },
  sourceKind: true,
  titleQuery: true,
  id: true,
  providerKey: true,
  identityKind: true,
  identityValue: true,
  uploaderUid: true,
  uidRevalidationRequiredAt: true,
  displayName: true,
  status: true,
  latestSeenExternalId: true,
  incrementalCursor: true,
  historyCursor: true,
  lastScanAt: true,
  lastSuccessAt: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ArchiveUploaderSourceSelect

export type SourceWire = Prisma.ArchiveUploaderSourceGetPayload<{ select: typeof sourceWireSelect }>

export function serializeSource(source: SourceWire) {
  const { incrementalCursor, historyCursor, ...wire } = source
  const hasCompletedScan = source.lastSuccessAt !== null
  const uidBindingState = source.uploaderUid
    ? source.uidRevalidationRequiredAt
      ? ('REVALIDATION_REQUIRED' as const)
      : ('BOUND' as const)
    : ('UNBOUND' as const)
  return {
    ...wire,
    defaultCreators: (source.defaultCreators ?? []).map((row) => row.artist),
    titleQuery: source.titleQuery ? archiveTitleQuerySchema.parse(source.titleQuery) : null,
    uidBindingState,
    hasPendingLatest: incrementalCursor !== null,
    canContinueHistory: historyCursor !== null,
    latestCoverage: !hasCompletedScan
      ? ('NOT_SCANNED' as const)
      : incrementalCursor
        ? ('HAS_MORE' as const)
        : ('CURRENT' as const),
    historyCoverage: !hasCompletedScan
      ? ('NOT_SCANNED' as const)
      : historyCursor
        ? ('HAS_MORE' as const)
        : ('EXHAUSTED' as const),
    lastErrorMessage: archiveWireErrorMessage(source.lastErrorCode, source.lastErrorMessage)
  }
}

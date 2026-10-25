import type { ArtworkDedupGroupDto, ArtworkDedupMemberDto, ArtworkDedupOperationDto } from '@pixishelf/job-contracts'

export const exactRelation = {
  relationKind: 'EXACT' as const,
  containedArtworkId: null,
  containerArtworkId: null,
  containedFileCount: null,
  containerFileCount: null,
  extraFileCount: null
}

export const containmentRelation = {
  relationKind: 'CONTAINS' as const,
  containedArtworkId: 1,
  containerArtworkId: 2,
  containedFileCount: '80',
  containerFileCount: '100',
  extraFileCount: '20'
}

export function member(artworkId = 1): ArtworkDedupMemberDto {
  return {
    artworkId,
    title: `作品 ${artworkId}`,
    sourceLabel: '本地作品',
    thumbnailUrl: null,
    createdAt: '2026-10-23T00:00:00Z',
    ownOrganization: {
      rating: null,
      bookmarks: { available: 0, unavailable: 1 },
      likes: { available: 0, unavailable: 0 }
    },
    ownReading: null,
    otherAccountHasOrganization: false
  }
}
export function group(groupId = 'group-1', overrides: Partial<ArtworkDedupGroupDto> = {}): ArtworkDedupGroupDto {
  return {
    ...exactRelation,
    groupId,
    memberCount: 2,
    fileCount: '12',
    previewMembers: [member(1), member(2)],
    keeper: member(1),
    recommendedKeeperArtworkId: 1,
    recommendationReason: 'CREATED',
    savedReview: null,
    reviewVersion: 0,
    needsExplicitChoice: false,
    eligibility: 'ELIGIBLE',
    reasons: [],
    ...overrides
  }
}
export function containmentGroup(overrides: Partial<ArtworkDedupGroupDto> = {}): ArtworkDedupGroupDto {
  return group('contains-1', {
    ...containmentRelation,
    keeper: member(2),
    recommendedKeeperArtworkId: 2,
    ...overrides
  })
}
export function operation(overrides: Partial<ArtworkDedupOperationDto> = {}): ArtworkDedupOperationDto {
  return {
    operationId: 'op-1',
    artistId: 7,
    runId: 'run-1',
    runVersion: 3,
    version: 1,
    executionVersion: 1,
    jobId: 'job-1',
    mode: 'PREPARE',
    originalAction: 'PREPARE',
    preparePurpose: 'DIRECT_DELETE',
    protocolVersion: 1,
    scopeDigest: 'a'.repeat(64),
    deleteStartedAt: null,
    stopRequested: false,
    status: 'READY',
    stage: 'DONE',
    createdAt: '2026-10-24T00:00:00Z',
    updatedAt: '2026-10-24T00:00:00Z',
    validatedAt: '2026-10-24T00:00:00Z',
    counts: {
      selectedGroups: 1,
      excludedGroups: 0,
      blockedGroups: 0,
      keepers: 1,
      copies: 1,
      preparedArtworks: 2,
      preparedFiles: '12',
      logicalBytes: '1000',
      movedFiles: '0',
      restoredFiles: '0',
      deletedFiles: '0',
      completedCopies: 0,
      remainingCopies: 1,
      blockedCopies: 0,
      remainingFiles: '12',
      deleteIntentFiles: '0'
    },
    requiresOrganizationConfirmation: false,
    backupCheckpointRef: null,
    purgePreview: null,
    allowedActions: [],
    failure: null,
    ...overrides
  }
}

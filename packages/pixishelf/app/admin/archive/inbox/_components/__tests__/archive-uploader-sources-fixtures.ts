export const source = {
  id: 'source-1',
  providerKey: 'e-hentai',
  identityKind: 'UID',
  identityValue: '123',
  uploaderUid: '123',
  uidRevalidationRequiredAt: null,
  uidBindingState: 'BOUND',
  displayName: 'UID 123',
  status: 'ACTIVE',
  latestSeenExternalId: '302',
  hasPendingLatest: false,
  canContinueHistory: true,
  latestCoverage: 'CURRENT',
  historyCoverage: 'HAS_MORE',
  catalogCounts: { actionable: 1, processing: 0, archived: 0, attention: 0, total: 1 },
  lastScanAt: new Date('2026-09-02T11:11:00.000Z'),
  lastSuccessAt: new Date('2026-09-02T11:09:00.000Z'),
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: new Date('2026-09-02T10:00:00.000Z'),
  updatedAt: new Date('2026-09-02T11:11:00.000Z')
}

export const activeRun = {
  id: 'run-active',
  systemJobId: 'job-active',
  mode: 'LATEST',
  searchIdentityKind: 'UID',
  searchIdentityValue: '123',
  status: 'RUNNING',
  itemCount: 0,
  newCount: 0,
  activeCount: 0,
  archivedCount: 0,
  possibleUpdateCount: 0,
  replacementCount: 0,
  stopReason: null,
  startedAt: new Date('2026-09-02T11:11:00.000Z'),
  finishedAt: null,
  errorCode: null,
  errorMessage: null,
  createdAt: new Date('2026-09-02T11:11:00.000Z'),
  updatedAt: new Date('2026-09-02T11:11:00.000Z')
}

export const completedRun = {
  ...activeRun,
  id: 'run-completed',
  systemJobId: 'job-completed',
  status: 'COMPLETED',
  itemCount: 1,
  newCount: 1,
  startedAt: new Date('2026-09-02T11:09:00.000Z'),
  finishedAt: new Date('2026-09-02T11:10:00.000Z'),
  createdAt: new Date('2026-09-02T11:09:00.000Z'),
  updatedAt: new Date('2026-09-02T11:10:00.000Z')
}

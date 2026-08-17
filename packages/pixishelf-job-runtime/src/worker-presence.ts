import { workerHealthDtoSchema, type WorkerHealthDto, type WorkerPresenceStatus } from '@pixishelf/job-contracts'

export type WorkerPresenceRecord = WorkerHealthDto

export interface WorkerPresenceStore {
  write(record: WorkerPresenceRecord): Promise<void>
}

export interface WorkerInstanceDelegate {
  upsert(args: {
    where: { workerId: string }
    create: Record<string, unknown>
    update: Record<string, unknown>
  }): PromiseLike<unknown>
}

export interface WorkerPresenceDatabaseClient {
  workerInstance: WorkerInstanceDelegate
}

export interface WorkerInstanceRetentionDelegate {
  findMany(args: {
    where: Record<string, unknown>
    orderBy: { heartbeatAt: 'asc' }
    take: number
    select: { workerId: true }
  }): PromiseLike<Array<{ workerId: string }>>
  deleteMany(args: { where: Record<string, unknown> }): PromiseLike<{ count: number }>
}

export interface WorkerPresenceRetentionDatabaseClient {
  workerInstance: WorkerInstanceRetentionDelegate
}

export interface WorkerPresenceRetentionPolicy {
  stoppingRetentionMs?: number
  inactiveRetentionMs?: number
  batchSize?: number
}

const DEFAULT_STOPPING_RETENTION_MS = 24 * 60 * 60_000
const DEFAULT_INACTIVE_RETENTION_MS = 7 * 24 * 60 * 60_000
const DEFAULT_RETENTION_BATCH_SIZE = 100
const RETENTION_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60_000
const RETENTION_CONTINUATION_INTERVAL_MS = 60_000
const RETENTION_RETRY_INTERVAL_MS = 5 * 60_000

function retentionWhere(now: Date, policy: WorkerPresenceRetentionPolicy) {
  const stoppingBefore = new Date(now.getTime() - (policy.stoppingRetentionMs ?? DEFAULT_STOPPING_RETENTION_MS))
  const inactiveBefore = new Date(now.getTime() - (policy.inactiveRetentionMs ?? DEFAULT_INACTIVE_RETENTION_MS))
  return {
    OR: [
      { status: 'STOPPING', heartbeatAt: { lt: stoppingBefore } },
      { status: { in: ['STARTING', 'READY', 'DEGRADED'] }, heartbeatAt: { lt: inactiveBefore } }
    ]
  }
}

export async function cleanupStaleWorkerInstances(
  client: WorkerPresenceRetentionDatabaseClient,
  now = new Date(),
  policy: WorkerPresenceRetentionPolicy = {}
) {
  const batchSize = Math.min(
    Math.max(policy.batchSize ?? DEFAULT_RETENTION_BATCH_SIZE, 1),
    DEFAULT_RETENTION_BATCH_SIZE
  )
  const where = retentionWhere(now, policy)
  const candidates = await client.workerInstance.findMany({
    where,
    orderBy: { heartbeatAt: 'asc' },
    take: batchSize,
    select: { workerId: true }
  })
  const workerIds = candidates.map(({ workerId }) => workerId)
  if (workerIds.length === 0) return { selected: 0, deleted: 0, hasMore: false }

  // Recheck both identity and staleness in the delete so a concurrent heartbeat always wins.
  const deleted = await client.workerInstance.deleteMany({
    where: { AND: [{ workerId: { in: workerIds } }, where] }
  })
  return {
    selected: workerIds.length,
    deleted: deleted.count,
    hasMore: workerIds.length === batchSize
  }
}

function toDatabaseRecord(record: WorkerPresenceRecord) {
  return {
    workerId: record.workerId,
    status: record.status,
    serviceVersion: record.serviceVersion,
    hostname: record.hostname,
    processId: record.processId,
    capabilities: record.capabilities,
    startedAt: new Date(record.startedAt),
    heartbeatAt: new Date(record.heartbeatAt),
    lastError: record.lastError,
    updatedAt: new Date(record.updatedAt)
  }
}

export class PrismaWorkerPresenceStore implements WorkerPresenceStore {
  private nextRetentionMaintenanceAt = 0

  constructor(
    private readonly client: WorkerPresenceDatabaseClient,
    private readonly options: {
      retentionClient?: WorkerPresenceRetentionDatabaseClient
      now?: () => Date
      retentionMaintenanceIntervalMs?: number
      onRetentionError?: (error: unknown) => void
    } = {}
  ) {}

  async write(input: WorkerPresenceRecord) {
    const record = workerHealthDtoSchema.parse(input)
    const data = toDatabaseRecord(record)
    await this.client.workerInstance.upsert({
      where: { workerId: record.workerId },
      create: data,
      update: data
    })

    const now = this.options.now?.() ?? new Date()
    if (now.getTime() < this.nextRetentionMaintenanceAt) return
    const retentionClient = this.options.retentionClient ?? asRetentionClient(this.client)
    if (!retentionClient) return
    try {
      const result = await cleanupStaleWorkerInstances(retentionClient, now)
      this.nextRetentionMaintenanceAt =
        now.getTime() +
        (result.hasMore
          ? RETENTION_CONTINUATION_INTERVAL_MS
          : (this.options.retentionMaintenanceIntervalMs ?? RETENTION_MAINTENANCE_INTERVAL_MS))
    } catch (error) {
      // Presence persistence is the health signal. Best-effort retention must never turn a
      // successful heartbeat into DEGRADED; emit it separately and retry on a later heartbeat.
      this.nextRetentionMaintenanceAt = now.getTime() + RETENTION_RETRY_INTERVAL_MS
      this.options.onRetentionError?.(error)
    }
  }
}

function asRetentionClient(client: WorkerPresenceDatabaseClient) {
  const delegate = client.workerInstance as WorkerInstanceDelegate & Partial<WorkerInstanceRetentionDelegate>
  return typeof delegate.findMany === 'function' && typeof delegate.deleteMany === 'function'
    ? (client as WorkerPresenceDatabaseClient & WorkerPresenceRetentionDatabaseClient)
    : null
}

export interface WorkerIdentity {
  workerId: string
  serviceVersion: string
  hostname: string
  processId: number
  capabilities: WorkerHealthDto['capabilities']
}

export function createWorkerPresenceRecord(
  identity: WorkerIdentity,
  status: WorkerPresenceStatus,
  now: Date,
  startedAt: Date,
  lastError: string | null
): WorkerPresenceRecord {
  const timestamp = now.toISOString()
  return workerHealthDtoSchema.parse({
    ...identity,
    status,
    capabilities: [...identity.capabilities],
    startedAt: startedAt.toISOString(),
    heartbeatAt: timestamp,
    lastError,
    updatedAt: timestamp
  })
}

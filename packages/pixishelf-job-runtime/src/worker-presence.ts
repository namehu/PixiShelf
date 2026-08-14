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
  constructor(private readonly client: WorkerPresenceDatabaseClient) {}

  async write(input: WorkerPresenceRecord) {
    const record = workerHealthDtoSchema.parse(input)
    const data = toDatabaseRecord(record)
    await this.client.workerInstance.upsert({
      where: { workerId: record.workerId },
      create: data,
      update: data
    })
  }
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

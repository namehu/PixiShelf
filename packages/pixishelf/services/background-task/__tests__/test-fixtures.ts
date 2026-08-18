import {
  type SystemJobEventWireRecord,
  type SystemJobWireRecord,
  type WorkerInstanceWireRecord
} from '../job-serialization'

const baseTime = new Date('2026-08-14T10:00:00.000Z')

export function jobRecord(overrides: Partial<SystemJobWireRecord> = {}): SystemJobWireRecord {
  return {
    id: 'job-1',
    type: 'SCAN',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: 1,
    status: 'PENDING',
    triggerSource: 'MANUAL',
    requestedByUserId: 'user-1',
    scheduledTaskId: null,
    scheduledForDate: null,
    idempotencyKey: null,
    payload: {},
    progress: 0,
    stage: null,
    message: null,
    result: null,
    errorCode: null,
    error: null,
    skipReason: null,
    attempt: 0,
    maxAttempts: 3,
    parentJobId: null,
    queuePriority: 10,
    effectivePriority: 10,
    availableAt: baseTime,
    deadlineAt: null,
    workerId: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides
  }
}

export function eventRecord(overrides: Partial<SystemJobEventWireRecord> = {}): SystemJobEventWireRecord {
  return {
    id: BigInt(1),
    jobId: 'job-1',
    type: 'job.queued',
    level: 'INFO',
    attempt: 0,
    workerId: null,
    stage: null,
    progress: null,
    message: 'Background job queued',
    data: null,
    createdAt: baseTime,
    job: { type: 'SCAN' },
    ...overrides
  }
}

export function workerRecord(overrides: Partial<WorkerInstanceWireRecord> = {}): WorkerInstanceWireRecord {
  return {
    workerId: 'worker-1',
    status: 'READY',
    serviceVersion: '1.0.0',
    hostname: 'worker-host',
    processId: 42,
    capabilities: [{ jobType: 'SCAN', definitionVersions: [1] }],
    startedAt: baseTime,
    heartbeatAt: baseTime,
    lastError: null,
    updatedAt: baseTime,
    ...overrides
  }
}

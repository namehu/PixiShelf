import { describe, expect, it, vi } from 'vitest'
import type { WorkerPresenceRecord } from '@pixishelf/job-runtime'
import { PresenceReadinessGate } from '../presence-readiness-gate.js'

describe('PresenceReadinessGate', () => {
  it('keeps heartbeat recovery at STARTING until startup explicitly allows READY', async () => {
    const records: WorkerPresenceRecord[] = []
    const delegate = { write: vi.fn(async (record: WorkerPresenceRecord) => void records.push(record)) }
    const gate = new PresenceReadinessGate(delegate)
    const readyRecord = presenceRecord('READY')

    await gate.write(readyRecord)
    await gate.write(presenceRecord('DEGRADED'))
    expect(records.map(({ status }) => status)).toEqual(['STARTING', 'DEGRADED'])

    gate.allowReady()
    await gate.write(readyRecord)
    expect(records.map(({ status }) => status)).toEqual(['STARTING', 'DEGRADED', 'READY'])
  })
})

function presenceRecord(status: WorkerPresenceRecord['status']): WorkerPresenceRecord {
  return {
    workerId: 'worker-gated',
    status,
    serviceVersion: '1.0.0',
    hostname: 'worker-host',
    processId: 42,
    capabilities: [],
    startedAt: '2026-08-14T00:00:00.000Z',
    heartbeatAt: '2026-08-14T00:00:01.000Z',
    lastError: null,
    updatedAt: '2026-08-14T00:00:01.000Z'
  }
}

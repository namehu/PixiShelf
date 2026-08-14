import type { WorkerPresenceRecord, WorkerPresenceStore } from '@pixishelf/job-runtime'

/** Keeps heartbeat recovery from advertising READY before startup prerequisites finish. */
export class PresenceReadinessGate implements WorkerPresenceStore {
  private readyAllowed = false

  constructor(private readonly store: WorkerPresenceStore) {}

  allowReady() {
    this.readyAllowed = true
  }

  write(record: WorkerPresenceRecord): Promise<void> {
    if (record.status === 'READY' && !this.readyAllowed) {
      return this.store.write({ ...record, status: 'STARTING' })
    }
    return this.store.write(record)
  }
}

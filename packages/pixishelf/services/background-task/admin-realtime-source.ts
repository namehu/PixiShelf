import 'server-only'
import type { Prisma } from '@pixishelf/db'
import type { AdminRealtimeResource, WorkerSnapshot } from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { toWorkerHealthDto, workerInstanceWireSelect } from './job-serialization'

export interface AdminRealtimeSource {
  readChanges(now: Date): Promise<AdminRealtimeResource[]>
  readWorkers(now: Date): Promise<WorkerSnapshot>
}

type Database = Pick<Prisma.TransactionClient, 'adminRealtimeRevision' | 'archiveIntakeItem' | 'workerInstance'>

export class PostgresAdminRealtimeSource implements AdminRealtimeSource {
  private revisions: Map<string, bigint> | undefined
  private nextBoundary: number | null = null

  constructor(private readonly database: Database = prisma as unknown as Database) {}

  async readChanges(now: Date): Promise<AdminRealtimeResource[]> {
    const rows = await this.database.adminRealtimeRevision.findMany()
    const changed = rows
      .filter((row) => this.revisions && this.revisions.get(row.resource) !== row.revision)
      .map((row) => row.resource as AdminRealtimeResource)
    const expired = this.nextBoundary !== null && now.getTime() >= this.nextBoundary
    if (expired && !changed.includes('archiveInbox')) changed.push('archiveInbox')
    const refreshBoundary = !this.revisions || changed.includes('archiveInbox')
    this.revisions = new Map(rows.map((row) => [row.resource, row.revision]))
    if (refreshBoundary) {
      const [ready, failed] = await Promise.all([
        this.database.archiveIntakeItem.aggregate({
          where: { status: 'READY', expiresAt: { gt: now } },
          _min: { expiresAt: true }
        }),
        this.database.archiveIntakeItem.aggregate({
          where: { status: 'FAILED', updatedAt: { gte: new Date(now.getTime() - 86_400_000) } },
          _min: { updatedAt: true }
        })
      ])
      const boundaries = [
        ready._min.expiresAt?.getTime(),
        // Summary includes the exact 24-hour boundary, so expire one millisecond later.
        failed._min.updatedAt ? failed._min.updatedAt.getTime() + 86_400_001 : undefined
      ].filter((value): value is number => value !== undefined)
      this.nextBoundary = boundaries.length ? Math.min(...boundaries) : null
    }
    return changed
  }

  async readWorkers(now: Date): Promise<WorkerSnapshot> {
    const workers = await this.database.workerInstance.findMany({
      orderBy: { heartbeatAt: 'desc' },
      select: workerInstanceWireSelect
    })
    return { version: 1, sampledAt: now.toISOString(), workers: workers.map(toWorkerHealthDto) }
  }
}

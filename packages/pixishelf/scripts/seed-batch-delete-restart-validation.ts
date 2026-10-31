import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { seedBatchDeleteFixture } from '../services/__tests__/artwork-batch-delete-fixture'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  if (url.hostname !== '127.0.0.1' || url.port !== '56432' || url.pathname !== '/pixishelf_batch')
    throw new Error('Only isolated restart validation is allowed')
  const root = '/private/tmp/pixishelf-batch-delete-env/media'
  process.env.ARCHIVE_STORAGE_PATH = root
  const db = new PrismaClient()
  try {
    const fixture = await seedBatchDeleteFixture(db, root, { userId: 'batch-restart-validation' })
    const target = fixture.groups[0]!
    const folder = path.join(root, path.dirname(target.files[1]!))
    for (let index = 0; index < 1000; index++)
      await fs.writeFile(path.join(folder, `restart-${index}.txt`), 'Disposable restart fixture only.\n')
    const { createArtworkDeletionService, createDeletionGuard, createDeletionContentContext } = await import(
      '@pixishelf/job-executors/artwork-delete'
    )
    const service = createArtworkDeletionService({
      database: db,
      getScanPath: async () => root,
      guard: createDeletionGuard(db, createDeletionContentContext(db, root)),
      logger: { info() {}, warn() {} },
      requestArchiveArtworkMaintenance: async () => {
        throw new Error('This fixture targets a direct-delete artwork')
      }
    })
    const preview = await service.previewDeleteArtwork(target.target, fixture.userId)
    const { artworkBatchDeletePayloadSchema } = await import('@pixishelf/job-contracts')
    const payload = artworkBatchDeletePayloadSchema.parse({
      confirmed: true,
      stopAfterCurrent: false,
      round: 0,
      origin: null,
      items: [
        {
          artworkId: target.target,
          operationId: preview.operationId,
          preview,
          selectedPaths: preview.entries
            .filter((entry) => ['REQUIRED', 'OPTIONAL'].includes(entry.selection))
            .map((entry) => entry.path)
        }
      ]
    })
    // The public confirmation path is covered separately; this provisions only an authorized Worker fixture.
    const job = await db.systemJob.create({
      data: {
        id: randomUUID(),
        type: 'ARTWORK_BATCH_DELETE',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        triggerSource: 'MANUAL',
        requestedByUserId: fixture.userId,
        queuePriority: 20,
        effectivePriority: 20,
        payload,
        result: { items: [] }
      }
    })
    const batch = { jobId: job.id, payload }
    const evidence = {
      jobId: batch.jobId,
      artworkId: target.target,
      operationId: batch.payload.items[0]!.operationId,
      files: batch.payload.items[0]!.selectedPaths.length,
      root
    }
    await fs.writeFile(
      '/private/tmp/pixishelf-batch-delete-env/restart-fixture.json',
      JSON.stringify(evidence, null, 2)
    )
    process.stdout.write(JSON.stringify(evidence) + '\n')
  } finally {
    await db.$disconnect()
  }
}
void main().catch((error) => {
  process.stderr.write(String(error) + '\n')
  process.exitCode = 1
})

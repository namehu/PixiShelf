import * as fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { completeArtworkDedupPrepare } from '@pixishelf/db'
import { db, root, fixture, finishInventory, finishDirectory } from './maintenance-executor-fixture.ts'

describe.skipIf(!db)('PREPARE exact archive evidence from actual download/seal/drain/publication', () => {
  it('accepts the actual manifest and exact staged-path mapping without inferring page index from sort order', async () => {
    const f = await fixture(1, 'URL_ARCHIVE')
    try {
      for (const id of f.ids) {
        await finishInventory(f, id)
        await finishDirectory(f, id)
      }
      const op = await f.context.transaction((tx) =>
        completeArtworkDedupPrepare(tx, { execution: f.context.execution })
      )
      expect(op).toMatchObject({ status: 'READY', preparedFiles: 4n })
      const rows = await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id } })
      expect(rows.every((row) => row.status === 'VERIFIED' && row.ownershipStatus === 'VERIFIED')).toBe(true)
      expect(rows.filter((row) => row.role === 'SOURCE_FILE')).toHaveLength(2)
      const copies = await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: op.id, role: 'COPY' } })
      expect(op.logicalBytes).toBe(
        rows.filter((row) => row.artworkId === copies[0]!.artworkId).reduce((sum, row) => sum + row.size!, 0n)
      )
    } finally {
      await f.close()
    }
  }, 30000)
  it('blocks an identity-correct manifest whose bytes no longer match the sealed publication', async () => {
    const f = await fixture(1, 'URL_ARCHIVE')
    try {
      const revision = await db!.archiveRevision.findFirstOrThrow({ where: { artworkId: f.ids[0]! } })
      await fs.appendFile(path.join(root, revision.manifestPath), '\n')
      await finishInventory(f, f.ids[0]!)
      const row = await db!.artworkDedupOperationFile.findFirstOrThrow({
        where: { operationId: f.context.execution.operationId, revisionId: revision.id }
      })
      expect(row).toMatchObject({ status: 'BLOCKED', blockReason: 'ARCHIVE_MANIFEST_UNVERIFIED' })
      expect(await fs.readFile(path.join(root, revision.manifestPath), 'utf8')).toMatch(/\n$/)
    } finally {
      await f.close()
    }
  }, 30000)
})

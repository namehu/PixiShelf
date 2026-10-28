import * as fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { completeArtworkDedupPrepare } from '@pixishelf/db'
import { db, root, fixture, finishInventory, finishDirectory } from './maintenance-executor-fixture.ts'

describe.skipIf(!db)('PREPARE exact archive evidence from actual download/seal/drain/publication', () => {
  it.each(['valid', 'sha', 'index', 'path', 'extra', 'partial-seal', 'malformed'] as const)(
    'verifies legacy manifest mapping and preserves the original blocker: %s', async scenario => {
      const f = await fixture(1, 'URL_ARCHIVE', { purpose: 'DIRECT_DELETE' })
      try {
        for (const id of f.ids) {
          const revision = await db!.archiveRevision.findFirstOrThrow({ where: { artworkId: id } })
          if (scenario !== 'partial-seal') {
            await db!.archiveStagingGeneration.deleteMany({ where: { archiveImportId: revision.archiveImportId! } })
            await db!.archiveImport.update({ where: { id: revision.archiveImportId! }, data: { generationToken: null, sealedManifestSha256: null } })
          } else {
            await db!.archiveImport.update({ where: { id: revision.archiveImportId! }, data: { sealedManifestSha256: null } })
          }
          if (!['valid', 'partial-seal'].includes(scenario)) {
            const file = path.join(root, revision.manifestPath)
            const manifest = JSON.parse(await fs.readFile(file, 'utf8'))
            if (scenario === 'sha') manifest.media[0].sha256 = 'f'.repeat(64)
            if (scenario === 'index') manifest.media[0].index++
            if (scenario === 'path') manifest.media[0].path = 'media/unregistered.png'
            if (scenario === 'extra') manifest.media.push({ ...manifest.media[0], index: 100, path: 'media/extra.png' })
            await fs.writeFile(file, scenario === 'malformed' ? '{' : JSON.stringify(manifest))
          }
          await finishInventory(f, id)
          await finishDirectory(f, id)
          const source = await db!.artworkDedupOperationFile.findFirstOrThrow({ where: { operationId: f.context.execution.operationId, artworkId: id, role: 'SOURCE_FILE' } })
          if (scenario === 'malformed') expect(source.sha256).toBeNull()
          else expect(source.sha256).toMatch(/^[a-f0-9]{64}$/)
          expect(source.blockReason).toBe(scenario === 'valid' ? null : scenario === 'malformed' ? 'SOURCE_IDENTITY_MISMATCH' : 'ARCHIVE_MANIFEST_UNVERIFIED')
        }
        const op = await f.context.transaction(tx => completeArtworkDedupPrepare(tx, { execution: f.context.execution }))
        expect(op.status).toBe(scenario === 'valid' ? 'READY' : 'FAILED')
        expect(op.deletedFiles).toBe(0n)
      } finally { await f.close() }
    }, 30000
  )
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

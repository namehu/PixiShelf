import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  parseArtworkDedupSourceSnapshot,
  serializeArtworkDedupSourceSnapshot
} from '../../../pixishelf-job-contracts/src/artwork-dedup-source-snapshot'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `dedup-proof-${randomUUID()}`
describe.skipIf(!db)('persistent source proof slots', () => {
  afterAll(async () => {
    await db?.$disconnect()
  })
  it('persists the same validated proof in all five slots while omitted legacy values stay unproven', async () => {
    const proof = serializeArtworkDedupSourceSnapshot([
      {
        identity: { kind: 'PROVIDER', providerKey: 'fixture', externalId: prefix },
        sourceId: randomUUID(),
        generation: 9007199254740993n
      }
    ])
    await expect(
      db!.$transaction(async (tx) => {
        const run = await tx.scanRun.create({ data: { type: 'PIXIV', mode: 'FULL' } })
        const submission = await tx.archiveIntakeSubmission.create({
          data: { idempotencyKey: prefix, requestHash: 'a'.repeat(64), rawCount: 2, acceptedCount: 2 }
        })
        for (const [ordinal, snapshot] of [undefined, proof].entries()) {
          const data = snapshot === undefined ? {} : { dedupSourceSnapshot: snapshot }
          const job = await tx.systemJob.create({
            data: { type: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', payload: {} }
          })
          const rows = [
            await tx.scanRunMetadataInput.create({
              data: { scanRunId: run.id, ordinal, relativePath: `${prefix}/${ordinal}/meta.json`, ...data }
            }),
            await tx.scanRunLocalWorkInput.create({
              data: {
                scanRunId: run.id,
                ordinal,
                kind: 'MEDIA_DIRECTORY',
                relativePath: `${prefix}/${ordinal}/local`,
                ...data
              }
            }),
            await tx.pixivSourceAuditItem.create({
              data: {
                scanRunId: run.id,
                ordinal,
                differenceKind: 'MISSING',
                relativePath: `${prefix}/${ordinal}/audit.json`,
                ...data
              }
            }),
            await tx.archiveIntakeItem.create({
              data: {
                submissionId: submission.id,
                submittedUrl: `https://example.invalid/${prefix}/${ordinal}`,
                normalizedUrlHash: String(ordinal).repeat(64),
                ...data
              }
            }),
            await tx.archiveImport.create({
              data: {
                systemJobId: job.id,
                providerKey: 'fixture',
                externalId: `${prefix}/${ordinal}`,
                submittedUrl: 'https://example.invalid',
                canonicalUrl: 'https://example.invalid',
                locator: {},
                normalizedMetadata: {},
                rawMetadata: {},
                metadataHash: 'a'.repeat(64),
                creatorBucket: prefix,
                stagingPath: `${prefix}/${ordinal}`,
                ...data
              }
            })
          ]
          for (const row of rows) {
            if (snapshot === undefined) {
              expect(row.dedupSourceSnapshot).toBeNull()
              expect(() => parseArtworkDedupSourceSnapshot(row.dedupSourceSnapshot)).toThrow()
            } else expect(parseArtworkDedupSourceSnapshot(row.dedupSourceSnapshot)).toEqual(proof)
          }
        }
        throw new Error('rollback proof slot fixtures')
      })
    ).rejects.toThrow('rollback proof slot fixtures')
    expect(await db!.archiveIntakeSubmission.count({ where: { idempotencyKey: prefix } })).toBe(0)
  })
})

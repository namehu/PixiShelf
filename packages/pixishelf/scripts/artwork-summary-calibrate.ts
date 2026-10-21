import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { ARTWORK_SUMMARY_ALGORITHM_VERSION, artworkSummaryGroupsSchema } from '@pixishelf/job-contracts'

// Labels are prepared independently before comparing the frozen holdout set.
const labelsSchema = z.array(z.object({
  artworkId: z.number().int().positive(), generationId: z.string().uuid(),
  split: z.enum(['calibration', 'holdout']),
  boundaryBeforeMediaIds: z.array(z.number().int().positive()).min(1),
  distinctPairs: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1)
})).length(20)
async function main() {
  const file = process.argv[2]
  if (!file || !process.env.DATABASE_URL) throw Error('Usage: DATABASE_URL=… tsx scripts/artwork-summary-calibrate.ts labels.json')
  const labels = labelsSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  if (new Set(labels.map((label) => label.artworkId)).size !== 20 || labels.filter((label) => label.split === 'holdout').length !== 10) {
    throw Error('Require 20 distinct works, 10 calibration and 10 holdout')
  }
  const db = new PrismaClient()
  try {
    const results = []
    for (const label of labels) {
      const row = await db.artworkSummary.findUniqueOrThrow({ where: { artworkId: label.artworkId } })
      if (row.algorithmVersion !== ARTWORK_SUMMARY_ALGORITHM_VERSION || row.generationId !== label.generationId || row.publishedRevision !== row.sourceRevision || row.replaceInProgress) throw Error(`Stale or changed snapshot: ${label.artworkId}`)
      const groups = artworkSummaryGroupsSchema.parse(row.groups)
      const groupById = new Map(groups.flatMap((group, index) => group.mediaIds.map((id) => [id, index] as const)))
      const starts = new Set(groups.slice(1).map((group) => group.representativeMediaId))
      for (const id of [...label.boundaryBeforeMediaIds, ...label.distinctPairs.flat()]) if (!groupById.has(id)) throw Error(`Unknown labeled media: ${id}`)
      const retained = label.boundaryBeforeMediaIds.filter((id) => starts.has(id)).length
      const driftFailures = label.distinctPairs.filter(([a, b]) => groupById.get(a) === groupById.get(b)).length
      const total = groups.reduce((count, group) => count + group.mediaIds.length, 0)
      results.push({ artworkId: label.artworkId, split: label.split, total, representatives: groups.length,
        compressionRatio: total ? 1 - groups.length / total : 0, boundaryCount: label.boundaryBeforeMediaIds.length,
        retained, retention: retained / label.boundaryBeforeMediaIds.length, driftFailures })
    }
    const passed = results.every((row) => row.retention >= 0.95 && row.driftFailures === 0)
    process.stdout.write(JSON.stringify({ algorithmVersion: ARTWORK_SUMMARY_ALGORITHM_VERSION, passed, nasPerformanceVerified: false, results }, null, 2) + '\n')
    if (!passed) process.exitCode = 1
  } finally { await db.$disconnect() }
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'Calibration failed'}\n`); process.exitCode = 1 })

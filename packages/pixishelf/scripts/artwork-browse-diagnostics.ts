import { readFileSync } from 'node:fs'
import { loadEnvConfig } from '@next/env'
import { PrismaClient } from '@pixishelf/db'
import { ArtworksInfiniteQuerySchema } from '../schemas/artwork.dto'
import { diagnoseArtworkBrowse } from '../services/artwork-service/browse-diagnostics'

loadEnvConfig(process.cwd())
const db = new PrismaClient()
async function main() {
  // Input stays in a local file rather than shell history; reports never include it.
  const file = process.argv[2]
  if (!file) throw new Error('Input file required')
  const params = ArtworksInfiniteQuerySchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  if (!params.expectedUserId) throw new Error('Account required')
  const report = await diagnoseArtworkBrowse(db, params, params.expectedUserId)
  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...report,
        note: 'Read-only database/service measurements; plans use warmed buffers. HTTP/network latency is excluded.'
      },
      null,
      2
    ) + '\n'
  )
}
main()
  .catch(() => {
    process.stderr.write('Browse diagnostics failed: check input, connection and query timeout. No data was changed.\n')
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())

import { loadEnvConfig } from '@next/env'
import { PrismaClient } from '@pixishelf/db'
import { diagnoseStatistics } from '../services/statistics-diagnostics'

// Explicit DATABASE_URL wins; otherwise use the app's documented local env files.
loadEnvConfig(process.cwd())
const db = new PrismaClient()

async function main() {
  const report = await diagnoseStatistics(db)
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...report,
        nextStep: report.safeToEnable
          ? 'Counter checks passed. Review plans, then set STATISTICS_IMAGE_COUNT_MODE=counter and restart Web.'
          : 'Keep STATISTICS_IMAGE_COUNT_MODE=exact. Counters or triggers failed validation; no data was changed.',
        note: 'Plans run after consistency checks and therefore use warmed buffers. This does not measure cold disk reads or HTTP latency.'
      },
      (_, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    )}\n`
  )
  if (!report.safeToEnable) process.exitCode = 2
}

main()
  .catch(() => {
    // Connection/query exceptions may contain credentials or row data.
    process.stderr.write('Statistics diagnostics failed or exceeded the read-only query timeout. Keep exact mode.\n')
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())

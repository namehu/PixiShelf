import {
  createPrismaCutoverAuditReader,
  getCutoverAuditExitCode,
  parseCutoverAuditArguments,
  runCutoverAudit,
  serializeCutoverAuditReport
} from '@/services/cutover-audit'

async function main(): Promise<0 | 2> {
  const { sampleLimit } = parseCutoverAuditArguments(process.argv.slice(2))
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required.')
  }

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const report = await runCutoverAudit(createPrismaCutoverAuditReader(prisma), { sampleLimit })
    process.stdout.write(serializeCutoverAuditReport(report))
    return getCutoverAuditExitCode(report)
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode
  })
  .catch((error) => {
    process.stderr.write(
      `Background task cutover audit failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  })

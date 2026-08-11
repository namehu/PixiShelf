import { prisma } from '@/lib/prisma'

async function main() {
  const [
    totalArtworks,
    localStorageKeys,
    pixivReferences,
    eHentaiReferences,
    unknownOrigins,
    localRowsStillUsingLegacyExternalId
  ] = await prisma.$transaction([
    prisma.artwork.count(),
    prisma.artwork.count({ where: { storageKey: { not: null } } }),
    prisma.artworkExternalRef.count({ where: { providerKey: 'pixiv' } }),
    prisma.artworkExternalRef.count({ where: { providerKey: 'e-hentai' } }),
    prisma.artwork.count({ where: { createdVia: 'UNKNOWN' } }),
    prisma.artwork.count({
      where: {
        createdVia: { in: ['LOCAL_DIRECTORY', 'MANUAL_CREATE'] },
        externalId: { not: null }
      }
    })
  ])

  const unknownOriginSample = await prisma.artwork.findMany({
    where: { createdVia: 'UNKNOWN' },
    select: { id: true, externalId: true, source: true, storageKey: true },
    orderBy: { id: 'asc' },
    take: 100
  })

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        counts: {
          totalArtworks,
          localStorageKeys,
          pixivReferences,
          eHentaiReferences,
          unknownOrigins,
          localRowsStillUsingLegacyExternalId
        },
        notes: [
          'localRowsStillUsingLegacyExternalId is expected during the compatibility window; storageKey is authoritative for these rows.',
          'unknownOrigins were deliberately not guessed as Pixiv and should be reviewed before legacy columns are removed.'
        ],
        unknownOriginSample
      },
      null,
      2
    )}\n`
  )
}

main()
  .catch((error) => {
    process.stderr.write(`Archive identity report failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

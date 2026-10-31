import fs from 'node:fs/promises'
import { PrismaClient } from '@pixishelf/db'
import { hashPassword } from 'better-auth/crypto'
import { seedBatchDeleteFixture } from '../services/__tests__/artwork-batch-delete-fixture'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  if (url.hostname !== '127.0.0.1' || url.port !== '56432' || url.pathname !== '/pixishelf_batch')
    throw new Error('Only the isolated batch validation database is allowed')
  const root = '/private/tmp/pixishelf-batch-delete-env/media'
  await fs.mkdir(root, { recursive: true })
  const db = new PrismaClient()
  try {
    const userId = 'batch-browser-validation'
    await db.userBA.upsert({
      where: { id: userId },
      create: { id: userId, name: 'batch-review', email: 'batch-review@pixishelf.local', emailVerified: true },
      update: {}
    })
    await db.account.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: userId } },
      create: {
        userId,
        providerId: 'credential',
        accountId: userId,
        password: await hashPassword('batch-fixture-pass')
      },
      update: {}
    })
    const fixture = await seedBatchDeleteFixture(db, root, { userId, extraGroups: 20 })
    await db.artworkDedupReview.deleteMany({
      where: {
        runId: fixture.runId,
        groupId: {
          in: fixture.groups
            .filter((group) => group.kind === 'PARTIAL' || group.kind === 'VISUAL')
            .map((group) => group.groupId)
        }
      }
    })
    await db.setting.upsert({
      where: { key: 'scanPath' },
      create: { key: 'scanPath', value: root },
      update: { value: root }
    })
    await fs.writeFile(
      '/private/tmp/pixishelf-batch-delete-env/browser-fixture.json',
      JSON.stringify({ ...fixture, files: Object.fromEntries(fixture.files), root }, null, 2)
    )
    process.stdout.write(
      JSON.stringify({
        artistId: fixture.artistId,
        runId: fixture.runId,
        artworks: fixture.groups.length * 2,
        login: 'batch-review'
      }) + '\n'
    )
  } finally {
    await db.$disconnect()
  }
}
void main().catch((error) => {
  process.stderr.write(String(error) + '\n')
  process.exitCode = 1
})

import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@pixishelf/db'
import { hashPassword } from 'better-auth/crypto'
import sharp from 'sharp'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '55433' ||
    url.pathname !== '/pixishelf_reading_position_20261104_browser'
  )
    throw new Error('Only the dedicated reading-position browser fixture database is allowed')
  const root = '/private/tmp/pixishelf-reading-position-20261104/media'
  await mkdir(`${root}/pictures`, { recursive: true })
  await mkdir(`${root}/video`, { recursive: true })
  const db = new PrismaClient()
  try {
    for (const suffix of ['review', 'other', 'manual']) {
      const id = `reading-${suffix}`
      await db.userBA.create({ data: { id, name: id, email: `${id}@pixishelf.local`, emailVerified: true } })
      await db.account.create({
        data: {
          userId: id,
          providerId: 'credential',
          accountId: id,
          password: await hashPassword('reading-fixture-pass')
        }
      })
    }
    const artist = await db.artist.create({ data: { name: 'Reading fixture artist' } })
    const pictures = []
    for (let index = 0; index < 100; index++) {
      const label = String(index + 1).padStart(3, '0')
      const path = `pictures/${label}.jpg`
      await sharp(
        Buffer.from(
          `<svg width="800" height="1100"><rect width="800" height="1100" fill="hsl(${(index * 29) % 360},45%,80%)"/><text x="400" y="520" text-anchor="middle" font-family="sans-serif" font-size="170" fill="#243047">${label}</text><text x="400" y="630" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#243047">Reading position fixture</text></svg>`
        )
      )
        .jpeg()
        .toFile(`${root}/${path}`)
      pictures.push({
        path,
        width: 800,
        height: 1100,
        sortOrder: index,
        mediaType: 'IMAGE' as const,
        webpAnimationStatus: 1
      })
    }
    const pictureWork = await db.artwork.create({
      data: {
        title: 'Reading fixture · 100 pictures',
        artistId: artist.id,
        createdVia: 'MANUAL_CREATE',
        source: 'LOCAL_IMPORT',
        storagePath: 'pictures',
        logicalMediaCount: 100,
        images: { create: pictures }
      }
    })
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=15',
      '-t',
      '12',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-y',
      `${root}/video/fixture.mp4`
    ])
    const videoWork = await db.artwork.create({
      data: {
        title: 'Reading fixture · single video',
        artistId: artist.id,
        createdVia: 'MANUAL_CREATE',
        source: 'LOCAL_IMPORT',
        storagePath: 'video',
        logicalMediaCount: 1,
        images: { create: { path: 'video/fixture.mp4', width: 640, height: 360, mediaType: 'VIDEO' } }
      }
    })
    const emptyWork = await db.artwork.create({
      data: {
        title: 'Reading fixture · empty',
        artistId: artist.id,
        createdVia: 'MANUAL_CREATE',
        source: 'LOCAL_IMPORT'
      }
    })
    await db.setting.create({ data: { key: 'scanPath', value: root } })
    const result = {
      root,
      pictureWork: pictureWork.id,
      videoWork: videoWork.id,
      emptyWork: emptyWork.id,
      artistId: artist.id,
      login: 'reading-review',
      password: 'reading-fixture-pass',
      otherLogin: 'reading-other',
      manualLogin: 'reading-manual'
    }
    await writeFile('/private/tmp/pixishelf-reading-position-20261104/fixture.json', JSON.stringify(result, null, 2))
    console.info(JSON.stringify(result))
  } finally {
    await db.$disconnect()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

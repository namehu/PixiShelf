const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const repo = '/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf'
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const root = path.join(base, 'browser-media')
const req = createRequire(path.join(repo, 'packages/pixishelf/package.json'))
const { PrismaClient } = req('@prisma/client'),
  sharp = req('sharp')
const url = new URL(process.env.DATABASE_URL || '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.port, '55432')
assert.equal(url.pathname, '/dedup_hot_reuse_browser_20261030')
const db = new PrismaClient({ datasourceUrl: url.toString() })
const json = (value) => JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? String(item) : item), 2) + '\n'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function main() {
  assert.equal((await db.$queryRawUnsafe('SELECT current_database() name'))[0].name, url.pathname.slice(1))
  assert.equal(await db.artwork.count(), 50)
  assert.equal(await db.artist.count(), 1)
  const warm = JSON.parse(await fs.readFile(path.join(base, 'manifest.json'), 'utf8'))
  await fs.cp(warm.root, root, { recursive: true, preserveTimestamps: true, force: false, errorOnExist: true })
  await db.setting.update({ where: { key: 'scanPath' }, data: { value: root } })
  for (const name of ['browser-archive', 'browser-derived', 'browser-pixiv-data', 'browser-public', 'browser-tmp'])
    await fs.mkdir(path.join(base, name), { recursive: false })
  await fs.writeFile(path.join(base, 'browser-warm-manifest.json'), json({ ...warm, root }), {
    mode: 0o600,
    flag: 'wx'
  })
  const original = await Promise.all(warm.artworks[0].files.map((file) => fs.readFile(path.join(warm.root, file.path))))
  const animated = Buffer.from(
    'UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GMAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/TZoAEFOTUYwAAAAAAAAAAAAAAAAAAAAZAAAAFZQOCAYAAAANAEAnQEqAQABAAAAJiWkAANwAP789AAA',
    'base64'
  )
  const stills = await Promise.all(
    Array.from({ length: 4 }, (_, n) => {
      const pixels = Buffer.from(
        Array.from(
          { length: 192 * 192 * 3 },
          (_, i) =>
            (Math.floor((Math.floor(i / 3) % 192) / 16) * (41 + n * 7) + Math.floor(Math.floor(i / 576) / 20) * 71) %
            255
        )
      )
      return sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } })
        .png()
        .toBuffer()
    })
  )
  const border = await sharp(stills[3])
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' })
    .png()
    .toBuffer()
  const plans = [
    {
      key: 'exact-contains',
      name: '热检验收 · 完全一致与包含',
      works: [
        ['exact-a', '完整一致 A · 2 张', [original[0], original[1]]],
        ['exact-b', '完整一致 B · 2 张', [original[0], original[1]]],
        ['contains-small', '被包含 · 2 张', [original[2], original[3]]],
        ['contains-large', '完整保留 · 3 张', [original[2], original[3], original[4]]]
      ]
    },
    {
      key: 'partial',
      name: '热检验收 · 部分重复',
      works: [
        ['partial-a', '部分重复 A · 4 张共同 + A 独有', original.slice(5, 10)],
        ['partial-b', '部分重复 B · 4 张共同 + B 独有', [...original.slice(5, 9), original[10]]]
      ]
    },
    {
      key: 'mixed-visual',
      name: '热检验收 · 混合媒体疑似版本',
      works: [
        ['mixed-a', '混合 A · 4 张静图 + 1 张动图', [animated, ...stills]],
        [
          'mixed-b',
          '混合 B · 5 张静图 + 1 张动图',
          [Buffer.concat([animated, Buffer.from('synthetic-b-animation')]), ...stills.slice(0, 3), border, original[11]]
        ]
      ]
    }
  ]
  const result = {
    createdAt: new Date().toISOString(),
    database: url.pathname.slice(1),
    appUrl: 'http://127.0.0.1:5502',
    root,
    warmArtistId: warm.artistId,
    artists: [],
    allowedSyntheticDeleteArtworkIds: []
  }
  for (const plan of plans) {
    const artist = await db.artist.create({ data: { name: plan.name } })
    const manifest = {
      createdAt: result.createdAt,
      root,
      artistId: artist.id,
      account: warm.account,
      files: 0,
      artworks: [],
      fileStateDigest: ''
    }
    const digest = createHash('sha256')
    for (const [key, title, buffers] of plan.works) {
      const directory = 'hot-reuse-browser-' + key
      await fs.mkdir(path.join(root, directory), { recursive: false })
      const rows = [],
        files = []
      for (const [index, bytes] of buffers.entries()) {
        const isAnimation = key.startsWith('mixed-') && index === 0
        const relative = directory + '/' + String(index + 1).padStart(2, '0') + (isAnimation ? '.webp' : '.png')
        await fs.writeFile(path.join(root, relative), bytes, { flag: 'wx' })
        const metadata = await sharp(bytes).metadata(),
          stat = await fs.stat(path.join(root, relative), { bigint: true })
        const sha256 = hash(bytes)
        rows.push({
          path: relative,
          size: stat.size,
          width: metadata.width,
          height: metadata.height,
          mediaType: 'IMAGE',
          sortOrder: index
        })
        files.push({ path: relative, sha256, size: String(stat.size) })
        digest.update(
          JSON.stringify([
            relative,
            sha256,
            String(stat.size),
            String(stat.mtimeNs),
            String(stat.ino),
            String(stat.dev)
          ])
        )
      }
      const artwork = await db.artwork.create({
        data: {
          title,
          source: 'LOCAL_CREATED',
          createdVia: 'MANUAL_CREATE',
          storagePath: directory,
          storageKey: directory,
          creators: {
            create: {
              artistId: artist.id,
              evidence: { create: { provenance: 'MANUAL', evidenceKey: 'manual', present: true } }
            }
          },
          images: { create: rows }
        }
      })
      manifest.artworks.push({ id: artwork.id, key, title, files })
      manifest.files += files.length
      result.allowedSyntheticDeleteArtworkIds.push(artwork.id)
    }
    manifest.fileStateDigest = digest.digest('hex')
    const filename = 'browser-' + plan.key + '-manifest.json'
    await fs.writeFile(path.join(base, filename), json(manifest), { mode: 0o600, flag: 'wx' })
    result.artists.push({
      id: artist.id,
      key: plan.key,
      name: plan.name,
      files: manifest.files,
      artworks: manifest.artworks.map(({ id, key, title }) => ({ id, key, title })),
      manifest: filename
    })
  }
  await fs.writeFile(path.join(base, 'browser-fixtures.json'), json(result), { mode: 0o600, flag: 'wx' })
  console.log(json(result))
}
main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())

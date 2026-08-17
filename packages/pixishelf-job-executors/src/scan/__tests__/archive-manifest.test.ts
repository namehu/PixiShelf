import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAndVerifyArchiveManifest } from '../archive-manifest.js'
import { resolveSafeScanRoot } from '../paths.js'

const roots: string[] = []
const now = new Date('2026-08-15T00:00:00.000Z')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('archive manifest validation', () => {
  it('stream-verifies bounded unique media and emits a strong manifest fingerprint', async () => {
    const fixture = await archiveFixture()
    const result = await readAndVerifyArchiveManifest({
      root: await resolveSafeScanRoot(fixture.root),
      relativeDirectory: fixture.relativeDirectory,
      signal: new AbortController().signal,
      now,
      maxManifestBytes: 32_000,
      maxMediaItems: 2,
      maxMediaBytes: 32_000,
      maxJsonDepth: 12,
      maxPathDepth: 4
    })

    expect(result.media).toEqual([
      expect.objectContaining({
        index: 0,
        bytes: 5n,
        databasePath: `${fixture.relativeDirectory}/1.jpg`,
        mediaType: 'IMAGE',
        quality: 'ORIGINAL',
        mimeType: 'image/jpeg',
        originalFilename: 'source.jpg',
        sourcePageUrl: 'https://example.test/page/1'
      })
    ])
    expect(result).toMatchObject({
      creatorBucket: 'artist--fixture',
      requestedQuality: 'ORIGINAL',
      selectedQuality: 'ORIGINAL'
    })
    expect(result.workFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects duplicate media identities, unknown fields, depth and count overflow', async () => {
    const duplicate = await archiveFixture({ duplicate: true })
    await expect(readManifest(duplicate, { maxMediaItems: 2 })).rejects.toMatchObject({ code: 'METADATA_INVALID' })

    const unknown = await archiveFixture({ unknownField: true })
    await expect(readManifest(unknown)).rejects.toMatchObject({ code: 'METADATA_INVALID' })

    const deep = await archiveFixture({ locator: { a: { b: { c: { d: true } } } } })
    await expect(readManifest(deep, { maxJsonDepth: 3 })).rejects.toMatchObject({ code: 'METADATA_INVALID' })

    const relationship = await archiveFixture({ invalidRelationship: true })
    await expect(readManifest(relationship)).rejects.toMatchObject({ code: 'METADATA_INVALID' })

    const count = await archiveFixture()
    await expect(readManifest(count, { maxMediaItems: 0 })).rejects.toMatchObject({ code: 'METADATA_INVALID' })
  })

  it('enforces database bounds, supported media types, and canonicalizes duplicate tags', async () => {
    const overflow = await archiveFixture()
    await mutateManifest(overflow, (manifest) => {
      manifest.media[0]!.width = 2_147_483_648
    })
    await expect(readManifest(overflow)).rejects.toMatchObject({ code: 'METADATA_INVALID' })

    const unsupported = await archiveFixture()
    await fs.rename(
      path.join(unsupported.root, ...unsupported.relativeDirectory.split('/'), '1.jpg'),
      path.join(unsupported.root, ...unsupported.relativeDirectory.split('/'), '1.exe')
    )
    await mutateManifest(unsupported, (manifest) => {
      manifest.media[0]!.path = '1.exe'
    })
    await expect(readManifest(unsupported)).rejects.toMatchObject({ code: 'METADATA_INVALID' })

    const video = await archiveFixture()
    await fs.rename(
      path.join(video.root, ...video.relativeDirectory.split('/'), '1.jpg'),
      path.join(video.root, ...video.relativeDirectory.split('/'), '1.mp4')
    )
    await mutateManifest(video, (manifest) => {
      manifest.media[0]!.path = '1.mp4'
      manifest.media[0]!.mimeType = 'video/mp4'
      manifest.sourceSnapshot.normalized.tags = [
        { namespace: 'artist', name: 'alice' },
        { namespace: 'artist', name: 'alice' }
      ]
    })
    const parsed = await readManifest(video)
    expect(parsed.media[0]?.mediaType).toBe('VIDEO')
    expect(parsed.normalized.tags).toEqual([{ namespace: 'artist', name: 'alice' }])
  })
})

async function readManifest(
  fixture: { root: string; relativeDirectory: string },
  overrides: Partial<{ maxMediaItems: number; maxJsonDepth: number }> = {}
) {
  return readAndVerifyArchiveManifest({
    root: await resolveSafeScanRoot(fixture.root),
    relativeDirectory: fixture.relativeDirectory,
    signal: new AbortController().signal,
    now,
    maxManifestBytes: 32_000,
    maxMediaItems: overrides.maxMediaItems ?? 2,
    maxMediaBytes: 32_000,
    maxJsonDepth: overrides.maxJsonDepth ?? 12,
    maxPathDepth: 4
  })
}

async function archiveFixture(
  options: {
    duplicate?: boolean
    unknownField?: boolean
    locator?: Record<string, unknown>
    invalidRelationship?: boolean
  } = {}
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-manifest-'))
  roots.push(root)
  const relativeDirectory = 'local-imports/Archive/Work'
  const directory = path.join(root, ...relativeDirectory.split('/'))
  await fs.mkdir(directory, { recursive: true })
  const media = Buffer.from('image')
  await fs.writeFile(path.join(directory, '1.jpg'), media)
  const item = {
    index: 0,
    path: '1.jpg',
    originalFilename: 'source.jpg',
    sourcePageUrl: 'https://example.test/page/1',
    sourcePageLocator: { page: 1 },
    quality: 'ORIGINAL',
    mimeType: 'image/jpeg',
    width: 10,
    height: 20,
    bytes: String(media.length),
    sha256: createHash('sha256').update(media).digest('hex')
  }
  const manifest = {
    manifestVersion: 1,
    provider: {
      key: 'fixture',
      externalId: '42',
      canonicalUrl: 'https://example.test/42',
      locator: options.locator ?? {}
    },
    creatorBucket: 'artist--fixture',
    requestedQuality: 'ORIGINAL',
    selectedQuality: 'ORIGINAL',
    sourceSnapshot: {
      metadataHash: 'a'.repeat(64),
      normalized: { titles: { display: 'Fixture' }, tags: [] },
      raw: {}
    },
    relationships: options.invalidRelationship
      ? [
          {
            type: 'REPLACES',
            direction: 'OUTBOUND',
            providerKey: 'fixture',
            externalId: 'old',
            canonicalUrl: 'not-a-url'
          }
        ]
      : [],
    media: options.duplicate ? [item, { ...item }] : [item],
    createdAt: now.toISOString(),
    ...(options.unknownField ? { unexpected: true } : {})
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
  return { root, relativeDirectory }
}

async function mutateManifest(
  fixture: { root: string; relativeDirectory: string },
  mutate: (manifest: {
    media: Array<{ width: number; path: string; mimeType: string }>
    sourceSnapshot: { normalized: { tags: Array<{ namespace: string; name: string }> } }
  }) => void
) {
  const manifestPath = path.join(fixture.root, ...fixture.relativeDirectory.split('/'), 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  mutate(manifest)
  await fs.writeFile(manifestPath, JSON.stringify(manifest))
}

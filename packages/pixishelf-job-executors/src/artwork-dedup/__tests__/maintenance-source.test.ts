import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { DedupReaderSupervisor, type ControlledDedupReader } from '../reader.ts'
import { parseChapterManifest, createChapterManifestHash } from '../../video-processing/chapter-manifest.ts'
import {
  readMaintenanceDirectoryCheckpoint,
  encodeMaintenanceDirectoryState,
  decodeMaintenanceDirectoryState
} from '../maintenance-directory-checkpoint.ts'

const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const signal = new AbortController().signal
let directory: string | undefined, reader: ControlledDedupReader | undefined
afterEach(async () => {
  await reader?.close()
  reader = undefined
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  directory = undefined
})
async function fixture() {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-source-')))
  reader = new DedupReaderSupervisor({
    entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
    execArgv: ['--import', workerRequire.resolve('tsx')],
    stallMs: 5000
  }).create()
  await reader.start()
  const { source } = await reader.resolveRoots(
    { operation: 'roots', sourceRoot: directory, archiveRoot: directory, expectedPixivRootIdentity: null },
    signal
  )
  return { root: source, signal, offset: 0 }
}
it('verifies actual Pixiv metadata identity and reports bounded evidence without its private document', async () => {
  const input = await fixture()
  const metadata = { id: '42', user: 'creator', userId: '9', title: 'sample', description: 'x'.repeat(200000) }
  await fs.writeFile(path.join(directory!, '42-meta.json'), JSON.stringify(metadata))
  const result = await reader!.inspectSource({
    ...input,
    relativePath: '42-meta.json',
    expectedIdentity: { kind: 'PIXIV_METADATA', externalId: '42', format: 'json' }
  })
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(result.bytesRead).toBe(BigInt(Buffer.byteLength(JSON.stringify(metadata))))
  expect(result.media).toEqual([])
  expect(result).not.toHaveProperty('description')
  expect(reader!.metrics).toMatchObject({ reads: 1, bytesRead: result.bytesRead })
  await expect(
    reader!.inspectSource({
      ...input,
      relativePath: '42-meta.json',
      expectedIdentity: { kind: 'PIXIV_METADATA', externalId: '43', format: 'json' }
    })
  ).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_MISMATCH' })
})
it('uses the existing canonical chapter parser and frozen chapter hash', async () => {
  const input = await fixture()
  const chapter = {
    chapters: [{ end: 10, start: 0, duration: 10, index: 1, title: 'First' }],
    duration: 10,
    version: 1
  }
  await fs.writeFile(path.join(directory!, 'clip.chapters.json'), JSON.stringify(chapter))
  const expectedIdentity = {
    kind: 'CHAPTER' as const,
    chaptersHash: createChapterManifestHash(parseChapterManifest(chapter))
  }
  expect(
    (await reader!.inspectSource({ ...input, relativePath: 'clip.chapters.json', expectedIdentity })).sha256
  ).toMatch(/^[a-f0-9]{64}$/)
  await expect(
    reader!.inspectSource({
      ...input,
      relativePath: 'clip.chapters.json',
      expectedIdentity: { ...expectedIdentity, chaptersHash: 'a'.repeat(64) }
    })
  ).rejects.toMatchObject({ code: 'CHAPTER_IDENTITY_MISMATCH' })
})
it('returns archive identity and exact media references in 100/100/1 pages', async () => {
  const input = await fixture()
  const expectedIdentity = {
    kind: 'ARCHIVE_MANIFEST' as const,
    revisionId: 'revision-1',
    providerKey: 'fixture',
    externalId: 'post-1'
  }
  const media = Array.from({ length: 201 }, (_, index) => ({
    index,
    path: `media/${index}.jpg`,
    sha256: 'a'.repeat(64),
    bytes: '100'
  }))
  await fs.writeFile(
    path.join(directory!, 'manifest.json'),
    JSON.stringify({ revisionId: 'revision-1', provider: { key: 'fixture', externalId: 'post-1' }, media })
  )
  const first = await reader!.inspectSource({ ...input, relativePath: 'manifest.json', expectedIdentity })
  const second = await reader!.inspectSource({
    ...input,
    relativePath: 'manifest.json',
    expectedIdentity,
    offset: first.nextOffset!
  })
  const third = await reader!.inspectSource({
    ...input,
    relativePath: 'manifest.json',
    expectedIdentity,
    offset: second.nextOffset!
  })
  expect([first.media.length, second.media.length, third.media.length]).toEqual([100, 100, 1])
  expect(first.mediaCount).toBe(201)
  expect(third.nextOffset).toBeNull()
  expect(first.sha256).toBe(third.sha256)
  expect([...first.media, ...second.media, ...third.media]).toEqual(media)
  await expect(
    reader!.inspectSource({
      ...input,
      relativePath: 'manifest.json',
      expectedIdentity: { ...expectedIdentity, revisionId: 'other' }
    })
  ).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_MISMATCH' })
})
it.each(['DUPLICATE', 'TRAVERSAL'])(
  'refuses %s manifest entries instead of omitting them from a page',
  async (problem) => {
    const input = await fixture()
    const entry = {
      index: 0,
      path: problem === 'TRAVERSAL' ? '../outside' : 'media/0.jpg',
      sha256: 'a'.repeat(64),
      bytes: '10'
    }
    await fs.writeFile(
      path.join(directory!, 'manifest.json'),
      JSON.stringify({
        revisionId: 'revision',
        provider: { key: 'test', externalId: 'item' },
        media: problem === 'DUPLICATE' ? [entry, { ...entry, index: 1 }] : [entry]
      })
    )
    await expect(
      reader!.inspectSource({
        ...input,
        relativePath: 'manifest.json',
        expectedIdentity: { kind: 'ARCHIVE_MANIFEST', revisionId: 'revision', providerKey: 'test', externalId: 'item' }
      })
    ).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_MISMATCH' })
  }
)
it('rejects oversized sources before reading any content', async () => {
  const input = await fixture()
  await fs.writeFile(path.join(directory!, 'large.json'), '')
  await fs.truncate(path.join(directory!, 'large.json'), 16 * 1024 * 1024 + 1)
  await expect(
    reader!.inspectSource({
      ...input,
      relativePath: 'large.json',
      expectedIdentity: { kind: 'PIXIV_METADATA', externalId: '1', format: 'json' }
    })
  ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
  expect(reader!.metrics.bytesRead).toBe(0n)
})
it.each(['HARD_LINK', 'SYMLINK'])('does not approve a %s source', async (kind) => {
  const input = await fixture()
  await fs.writeFile(path.join(directory!, 'source.json'), '{}')
  if (kind === 'HARD_LINK') await fs.link(path.join(directory!, 'source.json'), path.join(directory!, 'linked.json'))
  else await fs.symlink('source.json', path.join(directory!, 'linked.json'))
  await expect(
    reader!.inspectSource({
      ...input,
      relativePath: 'linked.json',
      expectedIdentity: { kind: 'PIXIV_METADATA', externalId: '1', format: 'json' }
    })
  ).rejects.toMatchObject({ code: 'INVALID_FILE' })
})
it('round-trips nanosecond directory state without truncating its durable cursor', () => {
  const state = {
    size: 4n,
    mtimeNs: 1720300050000000123n,
    ctimeNs: 1720300050000000456n,
    deviceId: 1n,
    inode: 2n,
    linkCount: 3n
  }
  const encoded = encodeMaintenanceDirectoryState(state)
  const checkpoint = readMaintenanceDirectoryCheckpoint(
    { version: 1, visited: 100, stack: [{ relativePath: 'owned', afterName: '0100', expectedState: encoded }] },
    'owned'
  )
  expect(decodeMaintenanceDirectoryState(checkpoint.stack[0]!.expectedState)).toEqual(state)
})
it.each([
  { version: 1, visited: 10001, stack: [] },
  { version: 1, visited: 0, stack: [{ relativePath: '../outside', afterName: null, expectedState: null }] },
  { version: 1, visited: 1, stack: [{ relativePath: 'owned', afterName: 'file', expectedState: null }] },
  { version: 1, visited: 0, stack: [{ relativePath: 'other', afterName: null, expectedState: null }] },
  {
    version: 1,
    visited: 0,
    stack: [
      { relativePath: 'owned', afterName: null, expectedState: null },
      { relativePath: 'owned/a/b', afterName: null, expectedState: null }
    ]
  }
])('refuses corrupted or out-of-scope persisted directory evidence %#', (checkpoint) => {
  expect(() => readMaintenanceDirectoryCheckpoint(checkpoint, 'owned')).toThrow()
})

it('counts every byte of a fully read invalid source even when progress IPC is throttled', async () => {
  const input = await fixture()
  const content = Buffer.alloc(8 * 1024 * 1024, 120)
  await fs.writeFile(path.join(directory!, 'invalid.json'), content)
  await expect(
    reader!.inspectSource({
      ...input,
      relativePath: 'invalid.json',
      expectedIdentity: { kind: 'PIXIV_METADATA', externalId: '1', format: 'json' }
    })
  ).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_MISMATCH' })
  expect(reader!.metrics.bytesRead).toBe(BigInt(content.length))
  expect(reader!.metrics.reads).toBe(0)
})

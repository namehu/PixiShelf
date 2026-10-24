import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ArtworkContentDigest,
  ArtworkMemberDigest,
  compareContentTuples,
  inspectMediaContentFile,
  readMediaContentFile,
  resolveMediaContentRoots,
  resolveMediaContentPath,
  assertMediaContentRootUnchanged
} from '../index.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-content-')))
  roots.push(root)
  const binding = await resolveMediaContentRoots({
    sourceRoot: root,
    archiveRoot: root,
    expectedPixivRootIdentity: null
  })
  return { root, binding: binding.source }
}
const signal = () => new AbortController().signal
const tuple = (content: string) => ({
  size: BigInt(Buffer.byteLength(content)),
  sha256: createHash('sha256').update(content).digest('hex')
})
function digest(values: ReturnType<typeof tuple>[]) {
  const encoder = new ArtworkContentDigest(BigInt(values.length))
  const ordered = [...values].sort(compareContentTuples)
  ordered.forEach((value) => encoder.add(value))
  return encoder.digest()
}

describe('original media multiset encoding', () => {
  it('ignores order while retaining duplicate multiplicity and every physical animation member', () => {
    const a = tuple('apng'),
      b = tuple('video')
    expect(digest([a, b, a])).toBe(digest([b, a, a]))
    expect(digest([a, a, b])).not.toBe(digest([a, b, b]))
    expect(digest([a, b])).not.toBe(digest([b]))
  })
  it('requires all positive members and rejects unordered or malformed evidence', () => {
    const values = [tuple('a'), tuple('longer')].sort(compareContentTuples)
    const encoder = new ArtworkContentDigest(2n)
    encoder.add(values[0]!)
    expect(() => encoder.digest()).toThrow('Incomplete')
    expect(() => new ArtworkContentDigest(0n)).toThrow()
    expect(() => new ArtworkContentDigest(1n).add({ size: 0n, sha256: '0'.repeat(64) })).toThrow()
    const unordered = new ArtworkContentDigest(2n)
    unordered.add(values[1]!)
    expect(() => unordered.add(values[0]!)).toThrow('sorted')
  })
  it('keeps full bigint sizes and freezes member identity separately from content', () => {
    expect(digest([{ size: 9_007_199_254_740_993n, sha256: 'a'.repeat(64) }])).not.toBe(
      digest([{ size: 9_007_199_254_740_992n, sha256: 'a'.repeat(64) }])
    )
    const members = (pathName: string, revision: bigint) => {
      const hash = new ArtworkMemberDigest(1, 1n)
      hash.add({ imageId: 2, artworkId: 1, canonicalPath: pathName, sourceRevision: revision })
      return hash.digest()
    }
    expect(members('a.png', 0n)).not.toBe(members('b.png', 0n))
    expect(members('a.png', 0n)).not.toBe(members('a.png', 1n))
  })
})

describe('shared media namespace and read boundary', () => {
  it('unifies nested archive roots and does not create a Pixiv marker', async () => {
    const { root } = await fixture()
    await fs.mkdir(path.join(root, 'archive'))
    const mapping = await resolveMediaContentRoots({
      sourceRoot: root,
      archiveRoot: path.join(root, 'archive'),
      expectedPixivRootIdentity: null
    })
    expect(mapping.archive).toEqual(mapping.source)
    expect(mapping.archiveRelativePrefix).toBe('archive')
    expect(await fs.readdir(root)).toEqual(['archive'])
    await expect(
      resolveMediaContentRoots({
        sourceRoot: path.join(root, 'archive'),
        archiveRoot: root,
        expectedPixivRootIdentity: null
      })
    ).rejects.toMatchObject({ code: 'ROOT_CHANGED' })
  })
  it('rejects traversal, a parent symlink and an unexpected root marker', async () => {
    const { root, binding } = await fixture()
    await fs.mkdir(path.join(root, 'real'))
    await fs.writeFile(path.join(root, 'real', 'file'), 'data')
    await fs.symlink(path.join(root, 'real'), path.join(root, 'alias'))
    await expect(resolveMediaContentPath(binding, '../escape')).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
    await expect(resolveMediaContentPath(binding, 'alias/file')).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
    await fs.writeFile(
      path.join(root, '.pixishelf-root'),
      JSON.stringify({ version: 1, id: '00000000-0000-4000-8000-000000000001' })
    )
    await expect(assertMediaContentRootUnchanged(binding)).rejects.toMatchObject({ code: 'ROOT_CHANGED' })
    await expect(
      resolveMediaContentRoots({
        sourceRoot: root,
        archiveRoot: root,
        expectedPixivRootIdentity: '00000000-0000-4000-8000-000000000002'
      })
    ).rejects.toMatchObject({ code: 'ROOT_CHANGED' })
  })
  it('reads once with a fixed buffer and records nanosecond attributes', async () => {
    const { root, binding } = await fixture()
    const bytes = Buffer.alloc(160_000, 42)
    await fs.writeFile(path.join(root, 'sample.bin'), bytes)
    const progress: bigint[] = []
    const read = await readMediaContentFile({
      root: binding,
      relativePath: 'sample.bin',
      signal: signal(),
      onProgress: (value) => {
        progress.push(value)
      }
    })
    expect(read.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(read.bytesRead).toBe(BigInt(bytes.length))
    expect(progress).toEqual([65_536n, 131_072n, 160_000n])
    expect(read.state.mtimeNs).toBe((await fs.stat(path.join(root, 'sample.bin'), { bigint: true })).mtimeNs)
  })
  it('rejects an atomically replaced pathname even when the old open handle stays valid', async () => {
    const { root, binding } = await fixture()
    const file = path.join(root, 'sample')
    await fs.writeFile(file, Buffer.alloc(100_000, 1))
    await fs.writeFile(path.join(root, 'replacement'), Buffer.alloc(100_000, 2))
    let swapped = false
    await expect(
      readMediaContentFile({
        root: binding,
        relativePath: 'sample',
        signal: signal(),
        onProgress: async () => {
          if (!swapped) {
            swapped = true
            await fs.rename(path.join(root, 'replacement'), file)
          }
        }
      })
    ).rejects.toMatchObject({ code: 'FILE_CHANGED' })
  })
  it('rejects empty/missing files, in-place changes and cancellation without producing a digest', async () => {
    const { root, binding } = await fixture()
    await fs.writeFile(path.join(root, 'empty'), '')
    await expect(
      inspectMediaContentFile({ root: binding, relativePath: 'empty', signal: signal() })
    ).rejects.toMatchObject({ code: 'INVALID_FILE' })
    await expect(
      inspectMediaContentFile({ root: binding, relativePath: 'missing', signal: signal() })
    ).rejects.toMatchObject({ code: 'NOT_READABLE' })
    const file = path.join(root, 'sample')
    await fs.writeFile(file, Buffer.alloc(100_000, 1))
    let changed = false
    await expect(
      readMediaContentFile({
        root: binding,
        relativePath: 'sample',
        signal: signal(),
        onProgress: async () => {
          if (!changed) {
            changed = true
            await fs.truncate(file, 80_000)
          }
        }
      })
    ).rejects.toMatchObject({ code: 'FILE_CHANGED' })
    const controller = new AbortController()
    await expect(
      readMediaContentFile({
        root: binding,
        relativePath: 'sample',
        signal: controller.signal,
        onProgress: () => {
          controller.abort(new Error('cancelled fixture'))
        }
      })
    ).rejects.toThrow('cancelled fixture')
    await fs.rename(file, file + '.closed')
  })
})

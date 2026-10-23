import { uploadIdentity, createUploadProtocolMock } from './media-content-fixture'
const protocol = vi.hoisted(() => ({ value: null as ReturnType<typeof createUploadProtocolMock> | null }))
vi.mock('@/lib/prisma', async () => {
  const { createUploadProtocolMock } = await import('./media-content-fixture')
  protocol.value = createUploadProtocolMock()
  return { prisma: protocol.value.prisma }
})
vi.mock('../content-source-guard', async (original) => ({
  ...(await original<typeof import('../content-source-guard')>()),
  beginContentUpload: (...args: any[]) => protocol.value!.begin(args[0]),
  resolveContentPath: async (root: string, value: string) => ({ relativePath: path.relative(root, value) })
}))
vi.mock('@pixishelf/db', async (original) => ({
  ...(await original<typeof import('@pixishelf/db')>()),
  prepareMediaContentUploadChunk: (...args: any[]) => protocol.value!.prepare(args[0], args[1]),
  ackMediaContentUploadChunk: (...args: any[]) => protocol.value!.ack(args[0], args[1]),
  markMediaContentWriteRecoveryRequired: () => protocol.value!.recovery()
}))
vi.mock('../summary-source-guard', () => ({
  beginSummaryPathWrite: vi.fn(async () => []),
  finishSummaryPathWrite: vi.fn(async () => {})
}))
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleMediaUploadChunk } from '../media-upload'

vi.mock('../animation-source-guard', () => ({
  beginAnimationSourcePathWrite: vi.fn().mockResolvedValue([]),
  finishAnimationSourcePathWrite: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('sharp', () => ({ default: () => ({ metadata: async () => ({ width: 1, height: 1 }) }) }))

describe('parallel replacement uploads', () => {
  let scanRoot: string | null = null
  afterEach(async () => {
    if (scanRoot) await rm(scanRoot, { recursive: true, force: true })
  })

  it('completes three concurrent files in the same target directory', async () => {
    scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-upload-concurrent-'))
    const results = await Promise.all(
      [1, 2, 3].map((number) =>
        handleMediaUploadChunk({
          ...uploadIdentity(),
          scanRoot: scanRoot!,
          fileName: `${number}.jpg`,
          targetDir: 'artist/work',
          targetRelDir: '/artist/work',
          chunkIndex: 0,
          totalChunks: 1,
          offset: 0,
          declaredFileSize: 6,
          body: Readable.from(Buffer.from(`image${number}`))
        })
      )
    )
    expect(results.every((result) => result.type === 'final')).toBe(true)
    for (const number of [1, 2, 3]) {
      await expect(readFile(path.join(scanRoot, 'artist/work', `${number}.jpg`), 'utf8')).resolves.toBe(
        `image${number}`
      )
    }
  })
})

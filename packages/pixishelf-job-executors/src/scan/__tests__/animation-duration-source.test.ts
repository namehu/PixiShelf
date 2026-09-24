import { describe, expect, it } from 'vitest'
import { animationDurationSourceChanged } from '../animation-duration-source.ts'

describe('animation duration source reconciliation', () => {
  const image = {
    previousPath: 'local/a/image.webp',
    previousSize: 100n,
    path: 'local/a/image.webp',
    size: 120n
  }
  const metadata = {
    sourcePath: image.path,
    sourceSize: 100n,
    sourceMtimeMs: 1n,
    sourceCtimeMs: null,
    sourceDeviceId: null,
    sourceInode: null,
    status: 'PENDING'
  }

  it('invalidates a changed source when no file write is active', () => {
    expect(animationDurationSourceChanged({ ...image, metadata: { ...metadata, writeInProgress: false } })).toBe(true)
  })

  it('leaves an active chunk upload or replacement gate intact despite a changed stat', () => {
    expect(animationDurationSourceChanged({ ...image, metadata: { ...metadata, writeInProgress: true } })).toBe(false)
  })
})

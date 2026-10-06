import { describe, expect, it } from 'vitest'
import { animationDurationSourceChanged, canPreserveAnimationClassification } from '../animation-duration-source.ts'

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

describe('confirmed classification source identity', () => {
  const input = {
    previousPath: 'image.webp',
    previousSize: 100n,
    path: 'image.webp',
    size: 100n,
    mediaType: 'ANIMATION',
    webpAnimationStatus: 2,
    sourceState: { sizeBytes: 100n, mtimeMs: 1n, ctimeMs: 2n, deviceId: 3n, inode: 4n },
    metadata: {
      sourcePath: 'image.webp',
      sourceSize: 100n,
      sourceMtimeMs: 1n,
      sourceCtimeMs: 2n,
      sourceDeviceId: 3n,
      sourceInode: 4n,
      status: 'READY',
      writeInProgress: false
    }
  }
  it('preserves a confirmed type with full unchanged source identity', () => {
    expect(canPreserveAnimationClassification(input)).toBe(true)
  })
  it('requires positive evidence, including equal-size replacement identity', () => {
    expect(canPreserveAnimationClassification({ ...input, metadata: null })).toBe(false)
    const { sourceState: _state, ...withoutState } = input
    expect(canPreserveAnimationClassification(withoutState)).toBe(false)
    for (const field of ['sourceSize', 'sourceMtimeMs', 'sourceCtimeMs', 'sourceDeviceId', 'sourceInode'] as const) {
      expect(canPreserveAnimationClassification({ ...input, metadata: { ...input.metadata, [field]: null } })).toBe(
        false
      )
      expect(canPreserveAnimationClassification({ ...input, metadata: { ...input.metadata, [field]: 999n } })).toBe(
        false
      )
    }
    expect(
      canPreserveAnimationClassification({
        ...input,
        sourceState: { ...input.sourceState, inode: null },
        metadata: { ...input.metadata, sourceInode: null }
      })
    ).toBe(false)
    expect(canPreserveAnimationClassification({ ...input, webpAnimationStatus: 0 })).toBe(false)
    expect(canPreserveAnimationClassification({ ...input, mediaType: 'IMAGE' })).toBe(false)
    expect(
      canPreserveAnimationClassification({ ...input, metadata: { ...input.metadata, writeInProgress: true } })
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  parsePendingReplaceDirectoryName,
  parsePendingReplaceManifest,
  parsePendingReplaceMediaSnapshot
} from '../pending-replace.dto'

describe('parsePendingReplaceDirectoryName', () => {
  it('uses the final typed marker and preserves underscores in the external id', () => {
    expect(parsePendingReplaceDirectoryName('some_original__ext-local_123')).toEqual({
      originalName: 'some_original',
      externalId: 'local_123'
    })
  })

  it('rejects untyped and incomplete directory names', () => {
    expect(parsePendingReplaceDirectoryName('some_original_123')).toBeNull()
    expect(parsePendingReplaceDirectoryName('__ext-123')).toBeNull()
    expect(parsePendingReplaceDirectoryName('some_original__ext-')).toBeNull()
    expect(parsePendingReplaceDirectoryName('some_original__ext-.')).toBeNull()
    expect(parsePendingReplaceDirectoryName('some_original__ext-..')).toBeNull()
  })
})

describe('pending replacement persisted JSON codecs', () => {
  it('rejects file names that could escape the item directory', () => {
    expect(() =>
      parsePendingReplaceManifest([
        { name: '../outside.jpg', size: 1, mtimeMs: 1, kind: 'media', targetName: '123_p0.jpg' }
      ])
    ).toThrow()
    expect(() =>
      parsePendingReplaceMediaSnapshot([
        {
          sourceName: 'inside.jpg',
          targetName: '..\\outside.jpg',
          path: '/pending-replaces/work/inside.jpg',
          size: 1,
          width: 1,
          height: 1,
          order: 0
        }
      ])
    ).toThrow()
  })
})

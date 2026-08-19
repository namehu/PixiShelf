import { describe, expect, it } from 'vitest'
import { startLocalImportSchema } from '../local-import.dto'

describe('startLocalImportSchema', () => {
  it('canonicalizes valid local import work paths', () => {
    expect(
      startLocalImportSchema.parse({
        storagePaths: ['local-imports\\Artist\\Category\\Work']
      })
    ).toEqual({ storagePaths: ['local-imports/Artist/Category/Work'] })
  })

  it.each(['other/Artist/Work', 'local-imports/Artist', '../local-imports/Artist/Work'])(
    'rejects a path outside the local import work hierarchy: %s',
    (storagePath) => {
      expect(() => startLocalImportSchema.parse({ storagePaths: [storagePath] })).toThrow()
    }
  )

  it('rejects duplicate canonical work paths', () => {
    expect(() =>
      startLocalImportSchema.parse({
        storagePaths: ['local-imports/Artist/Work', 'local-imports\\Artist\\Work']
      })
    ).toThrow('Duplicate local import work path')
  })
})

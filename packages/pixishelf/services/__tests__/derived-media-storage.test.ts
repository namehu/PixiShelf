import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  getDerivedMediaStorageRoot,
  resolveDerivedMediaStoragePath
} from '@/services/derived-media-storage'

describe('derived media storage', () => {
  it('uses the project-local common directory by default', () => {
    const cwd = path.resolve('workspace', 'pixishelf')
    expect(getDerivedMediaStorageRoot({ configuredPath: '', cwd })).toBe(
      path.resolve(cwd, '.local-data', 'derived-media')
    )
  })

  it('accepts an absolute storage override on the current platform', () => {
    const configuredPath = path.resolve('persistent', 'derived-media')
    expect(getDerivedMediaStorageRoot({ configuredPath, cwd: path.resolve('ignored') })).toBe(configuredPath)
  })

  it('resolves nested generated paths inside their type root', () => {
    const root = path.resolve('derived-media', 'video', 'chapters')
    expect(resolveDerivedMediaStoragePath(root, '229/hash/1.webp')).toBe(
      path.join(root, '229', 'hash', '1.webp')
    )
  })

  it('rejects paths that are not safe relative generated-media paths', () => {
    const root = path.resolve('derived-media', 'video', 'chapters')
    expect(() => resolveDerivedMediaStoragePath(root, '../secret.webp')).toThrow('Invalid derived media path')
    expect(() => resolveDerivedMediaStoragePath(root, '229\\secret.webp')).toThrow('Invalid derived media path')
  })
})

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPixivDataStorageRoot } from '../pixiv-data-storage-paths'

describe('Pixiv data storage paths', () => {
  it('defaults local development to the existing public/pixiv_data directory', () => {
    const cwd = path.resolve('workspace', 'packages', 'pixishelf')

    expect(getPixivDataStorageRoot({ cwd, configuredPath: '' })).toBe(path.join(cwd, 'public', 'pixiv_data'))
  })

  it('uses the explicit in-container storage path when configured', () => {
    const configuredPath = path.resolve('mounted', 'pixiv_data')

    expect(getPixivDataStorageRoot({ cwd: path.resolve('ignored'), configuredPath })).toBe(configuredPath)
  })
})

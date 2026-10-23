// @vitest-environment node
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/services/setting.service', () => ({ getScanPath: async () => root }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }))
vi.mock('fs', async (original) => ({ ...(await original<typeof import('fs')>()), createReadStream: vi.fn() }))
import { GET } from '../[...path]/route'
let root: string
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-deletion-http-'))
  await fs.mkdir(path.join(root, '.pixishelf-upload-recovery', 'deletions'), { recursive: true })
  await fs.writeFile(
    path.join(root, '.pixishelf-upload-recovery', 'deletions', 'manifest.json'),
    'private recovery fixture'
  )
  await fs.symlink(path.join(root, '.pixishelf-upload-recovery'), path.join(root, 'visible-alias'), 'dir')
})
beforeEach(() => vi.mocked(createReadStream).mockClear())
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})
describe('media route recovery evidence exclusion', () => {
  it.each([
    ['.pixishelf-upload-recovery', 'deletions', 'manifest.json'],
    ['visible%2F..%2F.pixishelf-upload-recovery', 'deletions', 'manifest.json'],
    ['visible%5C..%5C.pixishelf-upload-recovery', 'deletions', 'manifest.json'],
    ['visible-alias', 'deletions', 'manifest.json']
  ])('rejects hidden or normalized alias segments %j', async (...segments) => {
    const response = await GET(new NextRequest('http://localhost/api/v1/images/fixture'), {
      params: Promise.resolve({ path: segments })
    })
    expect(response.status).toBe(403)
    expect(createReadStream).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('private recovery fixture')
  })
})

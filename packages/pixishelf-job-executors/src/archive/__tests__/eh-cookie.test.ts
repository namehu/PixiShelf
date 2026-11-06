import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEhCookie, getEhCookieStatus, loadEhCookie, normalizeEhCookie, saveEhCookie } from '../eh-cookie.js'

const environment = { EH_COOKIE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }
const fixtureCookie = 'ipb_member_id=fixture-member; ipb_pass_hash=fixture-secret'
let row: { value: string; updatedAt: Date } | null
const database = {
  setting: {
    findUnique: vi.fn(async () => row),
    upsert: vi.fn(async (input: { create: { value: string } }) => {
      row = { value: input.create.value, updatedAt: new Date('2026-11-05') }
    }),
    deleteMany: vi.fn(async () => {
      row = null
    })
  }
}

describe('shared EH cookie storage', () => {
  beforeEach(() => {
    row = null
    vi.clearAllMocks()
  })

  it('persists authenticated encryption, returns only status, and decrypts for the Worker', async () => {
    const status = await saveEhCookie(database as never, fixtureCookie, environment)
    expect(status).toMatchObject({ configured: true, readable: true, encryptionAvailable: true })
    expect(JSON.stringify(status)).not.toContain('fixture')
    expect(row!.value).not.toContain('fixture')
    expect(await loadEhCookie(database as never, environment)).toBe(fixtureCookie)
    await saveEhCookie(database as never, fixtureCookie, environment)
    const writes = database.setting.upsert.mock.calls
    expect(writes[0]![0].create.value).not.toBe(writes[1]![0].create.value)
    await clearEhCookie(database as never, environment)
    expect(await loadEhCookie(database as never, environment)).toBeNull()
  })

  it('reports a missing or rotated key without exposing secrets or decryption errors', async () => {
    await saveEhCookie(database as never, fixtureCookie, environment)
    expect(await getEhCookieStatus(database as never, {})).toMatchObject({
      configured: true,
      readable: false,
      encryptionAvailable: false
    })
    expect(
      await loadEhCookie(database as never, { EH_COOKIE_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') })
    ).toBeNull()
    const parts = row!.value.split('.')
    parts[3] = (parts[3]![0] === 'A' ? 'B' : 'A') + parts[3]!.slice(1)
    row!.value = parts.join('.')
    expect(await loadEhCookie(database as never, environment)).toBeNull()
  })

  it('rejects saving without a dedicated key before writing', async () => {
    await expect(saveEhCookie(database as never, fixtureCookie, {})).rejects.toMatchObject({ kind: 'KEY' })
    expect(database.setting.upsert).not.toHaveBeenCalled()
  })

  it.each(['', 'Cookie: ipb_member_id=a', 'a=b\r\nInjected: secret', 'a=b\0', 'a'.repeat(8193)])(
    'rejects invalid cookie input without echoing it',
    (input) => {
      expect(() => normalizeEhCookie(input)).toThrow()
    }
  )
})

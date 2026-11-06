import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const SETTING_KEY = 'archive_eh_cookie_encrypted'
type CookieDatabase = {
  setting: {
    findUnique(input: {
      where: { key: string }
      select: { value: true; updatedAt: true }
    }): PromiseLike<{ value: string | null; updatedAt: Date | string } | null>
    upsert(input: {
      where: { key: string }
      update: { value: string; type: string }
      create: { key: string; value: string; type: string }
    }): PromiseLike<unknown>
    deleteMany(input: { where: { key: string } }): PromiseLike<unknown>
  }
}
type Environment = Readonly<Record<string, string | undefined>>

export class EhCookieConfigurationError extends Error {
  constructor(
    readonly kind: 'INPUT' | 'KEY',
    message: string
  ) {
    super(message)
  }
}

function encryptionKey(environment: Environment): Buffer | null {
  const value = environment.EH_COOKIE_ENCRYPTION_KEY
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null
  const key = Buffer.from(value, 'base64')
  return key.length === 32 ? key : null
}

export function normalizeEhCookie(input: string): string {
  if (input.length > 8192 || /[\r\n]/.test(input) || input.includes('\0')) {
    throw new EhCookieConfigurationError('INPUT', 'EH Cookie 格式无效')
  }
  const entries = input
    .trim()
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (entries.length === 0 || entries.some((entry) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[\x21-\x7e]*$/.test(entry))) {
    throw new EhCookieConfigurationError('INPUT', '请粘贴 Cookie 请求头的值，格式为 name=value; name=value')
  }
  return entries.join('; ')
}

export async function getEhCookieStatus(database: CookieDatabase, environment: Environment = process.env) {
  const row = await database.setting.findUnique({
    where: { key: SETTING_KEY },
    select: { value: true, updatedAt: true }
  })
  const key = encryptionKey(environment)
  let readable = false
  if (row?.value && key) {
    try {
      decrypt(row.value, key)
      readable = true
    } catch {
      /* Report status only; never expose ciphertext or decryption errors. */
    }
  }
  return {
    configured: Boolean(row?.value),
    encryptionAvailable: key !== null,
    readable,
    updatedAt: row?.updatedAt ?? null
  }
}

export async function saveEhCookie(database: CookieDatabase, input: string, environment: Environment = process.env) {
  const key = encryptionKey(environment)
  if (!key) {
    throw new EhCookieConfigurationError(
      'KEY',
      '请先为 App 和 Worker 配置一致的独立 EH_COOKIE_ENCRYPTION_KEY（32 字节 Base64）'
    )
  }
  const cookie = normalizeEhCookie(input)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(SETTING_KEY))
  const encrypted = Buffer.concat([cipher.update(cookie, 'utf8'), cipher.final()])
  const value = [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64')
  ].join('.')
  await database.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value, type: 'encrypted' },
    create: { key: SETTING_KEY, value, type: 'encrypted' }
  })
  return getEhCookieStatus(database, environment)
}

export async function clearEhCookie(database: CookieDatabase, environment: Environment = process.env) {
  await database.setting.deleteMany({ where: { key: SETTING_KEY } })
  return getEhCookieStatus(database, environment)
}

export async function loadEhCookie(
  database: CookieDatabase,
  environment: Environment = process.env
): Promise<string | null> {
  const key = encryptionKey(environment)
  if (!key) return null
  const row = await database.setting.findUnique({
    where: { key: SETTING_KEY },
    select: { value: true, updatedAt: true }
  })
  if (!row?.value) return null
  try {
    return decrypt(row.value, key)
  } catch {
    return null
  }
}

function decrypt(value: string, key: Buffer): string {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid encrypted cookie')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAAD(Buffer.from(SETTING_KEY))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8')
}

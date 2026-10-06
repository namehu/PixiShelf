// @vitest-environment node
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAuth } from '@/lib/auth/better-auth'
import { AlreadyInitializedError, initializeAdmin } from '../init-admin-service'

// This suite requires a dedicated, migrated empty database: it must never use DATABASE_URL.
const databaseUrl = process.env.INIT_ADMIN_TEST_DATABASE_URL
const database = new PrismaClient({ datasourceUrl: databaseUrl })
const otherConnection = new PrismaClient({ datasourceUrl: databaseUrl })
let cleanupAllowed = false
const password = 'init-test-password'
const prefix = 'init-atomic-test-'

describe.skipIf(!databaseUrl).sequential('initial administrator PostgreSQL atomicity', () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.pathname !== '/init_admin_test') {
      throw new Error('Initialization tests only allow a loopback database named init_admin_test')
    }
    if (await database.userBA.count()) throw new Error('Initialization tests require an empty dedicated database')
    cleanupAllowed = true
  })

  beforeEach(async () => {
    await database.userBA.deleteMany({ where: { name: { startsWith: prefix } } })
  })

  afterAll(async () => {
    if (cleanupAllowed) await database.userBA.deleteMany({ where: { name: { startsWith: prefix } } })
    await Promise.all([database.$disconnect(), otherConnection.$disconnect()])
  })

  it('allows exactly one of two different usernames and creates a usable credential and session', async () => {
    const outcomes = await Promise.allSettled([
      initializeAdmin(`${prefix}one`, password, database),
      initializeAdmin(`${prefix}two`, password, otherConnection)
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(AlreadyInitializedError)
    expect(await database.userBA.count()).toBe(1)
    expect(await database.account.count()).toBe(1)
    expect(await database.session.count()).toBe(1)
    const user = await database.userBA.findFirstOrThrow()
    const login = await createAuth(database, false).api.signInEmail({
      body: { email: user.email!, password }
    })
    expect(login.user.id).toBe(user.id)
    const completed = outcomes.find((outcome) => outcome.status === 'fulfilled')
    expect(completed?.status === 'fulfilled' && completed.value.headers.get('set-cookie')).toContain('session_token')
  })

  it('rejects a stale initialization request regardless of the existing username', async () => {
    await database.userBA.create({ data: { name: `${prefix}existing`, email: 'existing@pixishelf.local' } })
    await expect(initializeAdmin(`${prefix}new`, password, database)).rejects.toBeInstanceOf(AlreadyInitializedError)
    expect(await database.userBA.count()).toBe(1)
    expect(await database.account.count()).toBe(0)
    expect(await database.session.count()).toBe(0)
  })

  it.each(['Account', 'Session'] as const)(
    'rolls back all writes when %s insertion fails, then permits retry',
    async (table) => {
      // A database constraint exercises the real adapter after the user has been inserted.
      await database.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT init_test_failure CHECK (false)`)
      try {
        await expect(initializeAdmin(`${prefix}failure`, password, database)).rejects.toThrow()
        expect(await database.userBA.count()).toBe(0)
        expect(await database.account.count()).toBe(0)
        expect(await database.session.count()).toBe(0)
      } finally {
        await database.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT init_test_failure`)
      }
      await expect(initializeAdmin(`${prefix}retry`, password, database)).resolves.toBeDefined()
    }
  )

  it('observes a concurrent ordinary registration committed before the table lock', async () => {
    let release!: () => void
    let inserted!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      inserted = resolve
    })
    const registration = database.$transaction(async (transaction) => {
      await createAuth(transaction, false).api.signUpEmail({
        body: { name: `${prefix}ordinary`, email: 'ordinary@pixishelf.local', password }
      })
      inserted()
      await gate
    })
    await ready
    const initialization = initializeAdmin(`${prefix}racing`, password, otherConnection)
    release()
    await registration
    await expect(initialization).rejects.toBeInstanceOf(AlreadyInitializedError)
    expect(await database.userBA.count()).toBe(1)
    expect(await database.account.count()).toBe(1)
    expect(await database.session.count()).toBe(1)
  })
})

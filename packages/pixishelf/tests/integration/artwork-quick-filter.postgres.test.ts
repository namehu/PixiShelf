// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { artworkQuerySnapshotSchema, QUICK_FILTER_PREFIX, quickFilterSchema } from '@/schemas/artwork-quick-filter.dto'
import {
  createQuickFilter,
  updateQuickFilter,
  deleteQuickFilter,
  listQuickFilters,
  setQuickFilterNavigation
} from '@/services/artwork-quick-filter-service'

const enabled = process.env.QUICK_FILTER_TEST_DATABASE === '1'
const suite = enabled ? describe : describe.skip
let fixturesCreated = false
const owner = `quick-filter-${randomUUID()}`
const other = `quick-filter-${randomUUID()}`
const query = artworkQuerySnapshotSchema.parse({ readingStatus: 'UNREAD', search: '测试' })
suite('quick filter PostgreSQL transactions', () => {
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!)
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/pixishelf_quick_filter_test') {
      throw new Error('Dedicated local test database required')
    }
    await prisma.userBA.createMany({ data: [{ id: owner }, { id: other }] })
    fixturesCreated = true
  })
  afterAll(async () => {
    if (fixturesCreated) await prisma.userBA.deleteMany({ where: { id: { in: [owner, other] } } })
    await prisma.$disconnect()
  })
  it('isolates accounts and serializes duplicate names', async () => {
    const attempts = await Promise.allSettled(
      [1, 2].map(() => createQuickFilter(owner, { name: '重复', query, pin: true }))
    )
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await listQuickFilters(other)).items).toHaveLength(0)
    const item = (await listQuickFilters(owner)).items[0]!
    await expect(updateQuickFilter(other, { ...item, name: '越界' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(deleteQuickFilter(other, item)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('preserves edits to distinct entries and rejects stale same-entry writes', async () => {
    const a = await createQuickFilter(owner, { name: '甲', query, pin: false })
    const b = await createQuickFilter(owner, { name: '乙', query, pin: false })
    await Promise.all([
      updateQuickFilter(owner, { ...a, name: '甲2' }),
      updateQuickFilter(owner, { ...b, name: '乙2' })
    ])
    const attempts = await Promise.allSettled(
      [3, 4].map((n) => updateQuickFilter(owner, { ...a, revision: 2, name: `甲${n}` }))
    )
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((attempts.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('CONFLICT')
    await expect(deleteQuickFilter(owner, a)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await listQuickFilters(owner)).items.some((i) => i.name === '乙2')).toBe(true)
  })
  it('caps pinned entries atomically and prevents stale order from resurrecting deleted entries', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, n) => createQuickFilter(owner, { name: `导航${n}`, query, pin: true }))
    )
    const state = await listQuickFilters(owner)
    expect(state.navigation.ids).toHaveLength(10)
    const deleted = state.items.find((i) => i.id === state.navigation.ids[0])!
    await deleteQuickFilter(owner, deleted)
    await expect(setQuickFilterNavigation(owner, state.navigation)).rejects.toMatchObject({ code: 'CONFLICT' })
    const current = await listQuickFilters(owner)
    expect(current.navigation.ids).not.toContain(deleted.id)
    const orders = await Promise.allSettled(
      [current.navigation.ids, [...current.navigation.ids].reverse()].map((ids) =>
        setQuickFilterNavigation(owner, { revision: current.navigation.revision, ids })
      )
    )
    expect(orders.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })
  it('allows only one final slot under concurrent creation', async () => {
    const state = await listQuickFilters(other)
    const data = Array.from({ length: 99 - state.items.length }, (_, n) => {
      const item = quickFilterSchema.parse({
        id: randomUUID(),
        schemaVersion: 1,
        revision: 1,
        name: `容量${n}`,
        query,
        createdAt: new Date().toISOString()
      })
      return { userId: other, key: QUICK_FILTER_PREFIX + item.id, type: 'json', value: JSON.stringify(item) }
    })
    await prisma.userSetting.createMany({ data })
    const attempts = await Promise.allSettled(
      [1, 2].map((n) => createQuickFilter(other, { name: `最后${n}`, query, pin: false }))
    )
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await listQuickFilters(other)).items).toHaveLength(100)
  })
  it('marks removed references unavailable and rejects invalid saves', async () => {
    await expect(
      createQuickFilter(owner, {
        name: '失效',
        pin: false,
        query: { ...query, artist: [{ value: '2147483647', label: '已删除艺术家' }] }
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const item = await createQuickFilter(owner, { name: '历史失效', query, pin: false })
    await prisma.userSetting.update({
      where: { userId_key: { userId: owner, key: QUICK_FILTER_PREFIX + item.id } },
      data: {
        value: JSON.stringify({ ...item, query: { ...query, tags: [{ value: '2147483647', label: '已删除标签' }] } })
      }
    })
    expect((await listQuickFilters(owner)).items.find((i) => i.id === item.id)?.invalidReferences).toEqual([
      '标签：已删除标签'
    ])
  })
})

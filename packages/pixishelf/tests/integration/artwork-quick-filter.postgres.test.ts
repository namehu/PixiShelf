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
let artistA: number
let artistB: number
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
    artistA = (await prisma.artist.create({ data: { name: owner } })).id
    artistB = (await prisma.artist.create({ data: { name: other } })).id
  })
  afterAll(async () => {
    if (fixturesCreated) await prisma.userBA.deleteMany({ where: { id: { in: [owner, other] } } })
    if (fixturesCreated) await prisma.artist.deleteMany({ where: { id: { in: [artistA, artistB] } } })
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
  it('isolates artist scopes, names and quota, rejects navigation and cross-scope CRUD', async () => {
    const scopeA = { kind: 'artist' as const, artistId: artistA }
    const scopeB = { kind: 'artist' as const, artistId: artistB }
    const a = await createQuickFilter(owner, { name: '重复', query, pin: false, scope: scopeA })
    const b = await createQuickFilter(owner, { name: '重复', query, pin: false, scope: scopeB })
    const otherA = await createQuickFilter(other, { name: '重复', query, pin: false, scope: scopeA })
    expect((await listQuickFilters(owner, scopeA)).items.map((i) => i.id)).toEqual([a.id])
    expect((await listQuickFilters(owner, scopeB)).items.map((i) => i.id)).toEqual([b.id])
    expect((await listQuickFilters(other, scopeA)).items.map((i) => i.id)).toEqual([otherA.id])
    expect((await listQuickFilters(other)).items).toHaveLength(100)
    expect((await listQuickFilters(owner)).items.some((i) => i.id === a.id || i.id === b.id)).toBe(false)
    for (const scope of [undefined, scopeB]) {
      await expect(updateQuickFilter(owner, { ...a, scope })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(deleteQuickFilter(owner, { ...a, scope })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    await expect(
      createQuickFilter(owner, { name: '不允许导航', query, pin: true, scope: scopeA })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      createQuickFilter(owner, {
        name: '不允许作者',
        query: { ...query, artist: [{ value: String(artistA), label: 'A' }] },
        pin: false,
        scope: scopeA
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(setQuickFilterNavigation(owner, { revision: 0, ids: [a.id] }, scopeA)).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    const global = await listQuickFilters(owner)
    await expect(
      setQuickFilterNavigation(owner, { revision: global.navigation.revision, ids: [a.id] })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const edited = await updateQuickFilter(owner, {
      ...a,
      scope: scopeA,
      name: '重命名',
      query: { ...query, excludedArtists: [{ value: String(artistA), label: '自己' }], ratingLevels: [4] }
    })
    await expect(updateQuickFilter(owner, { ...a, scope: scopeA })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await listQuickFilters(owner, scopeA)).items[0]?.query).toMatchObject({
      artist: [],
      ratingLevels: [4],
      excludedArtists: [{ value: String(artistA), label: '自己' }]
    })
    await deleteQuickFilter(owner, { ...edited, scope: scopeA })
    expect((await listQuickFilters(owner, scopeA)).items).toHaveLength(0)
    expect((await listQuickFilters(owner, scopeB)).items).toHaveLength(1)
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
        value: JSON.stringify({
          ...item,
          query: {
            ...query,
            tags: [{ value: '2147483647', label: '已删除标签' }],
            excludedArtists: [{ value: '2147483647', label: '已删除作者' }]
          }
        })
      }
    })
    expect((await listQuickFilters(owner)).items.find((i) => i.id === item.id)?.invalidReferences).toEqual([
      '排除艺术家：已删除作者',
      '标签：已删除标签'
    ])
  })
})

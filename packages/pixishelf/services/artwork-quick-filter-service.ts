import 'server-only'
import { randomUUID } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { prisma, type PrismaClientSingleton } from '@/lib/prisma'
import {
  QUICK_FILTER_PREFIX,
  QUICK_FILTER_ARTIST_PREFIX,
  GLOBAL_QUICK_FILTER_SCOPE,
  type QuickFilterScope,
  QUICK_FILTER_NAV_KEY,
  quickFilterSchema,
  quickFilterNavigationSchema,
  type ArtworkQuickFilter,
  type ArtworkQuerySnapshot
} from '@/schemas/artwork-quick-filter.dto'

type Tx = Omit<PrismaClientSingleton, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>
const fail = (message: string, code: 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND' = 'BAD_REQUEST'): never => {
  throw new TRPCError({ code, message })
}
function scopePrefix(scope: QuickFilterScope) {
  return scope.kind === 'artist' ? `${QUICK_FILTER_ARTIST_PREFIX}${scope.artistId}:` : QUICK_FILTER_PREFIX
}
async function readState(db: Tx, userId: string, scope: QuickFilterScope) {
  const rows = await db.userSetting.findMany({
    where: {
      userId,
      key: { startsWith: scopePrefix(scope) },
      ...(scope.kind === 'global' ? { NOT: { key: { startsWith: QUICK_FILTER_ARTIST_PREFIX } } } : {})
    },
    orderBy: { createdAt: 'desc' }
  })
  const items: ArtworkQuickFilter[] = []
  let navigation = { revision: 0, ids: [] as string[] }
  for (const row of rows) {
    const data: unknown = JSON.parse(row.value || '{}')
    if (row.key === QUICK_FILTER_NAV_KEY) navigation = quickFilterNavigationSchema.parse(data)
    else items.push(quickFilterSchema.parse(data))
  }
  return { items, navigation }
}
async function invalidReferences(db: Tx, query: ArtworkQuerySnapshot) {
  const [artists, tags] = await Promise.all([
    db.artist.findMany({
      where: { id: { in: [...query.artist, ...query.excludedArtists].map((a) => Number(a.value)) } },
      select: { id: true }
    }),
    db.tag.findMany({ where: { id: { in: query.tags.map((t) => Number(t.value)) } }, select: { id: true } })
  ])
  return [
    ...query.artist.filter((a) => !artists.some((v) => String(v.id) === a.value)).map((a) => `艺术家：${a.label}`),
    ...query.excludedArtists
      .filter((a) => !artists.some((v) => String(v.id) === a.value))
      .map((a) => `排除艺术家：${a.label}`),
    ...query.tags.filter((t) => !tags.some((v) => String(v.id) === t.value)).map((t) => `标签：${t.label}`)
  ]
}
async function write(db: Tx, userId: string, key: string, value: unknown) {
  const data = { value: JSON.stringify(value), type: 'json' }
  await db.userSetting.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, ...data },
    update: data
  })
}
// A real account row lock serializes quota/name/order checks across all application instances.
async function mutate<T>(
  userId: string,
  scope: QuickFilterScope,
  operation: (db: Tx, state: Awaited<ReturnType<typeof readState>>) => Promise<T>
) {
  return prisma.$transaction(async (db) => {
    const users = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "UserBA" WHERE id = ${userId} FOR UPDATE`
    if (!users.length) throw new TRPCError({ code: 'UNAUTHORIZED' })
    return operation(db, await readState(db, userId, scope))
  })
}
export async function listQuickFilters(userId: string, scope: QuickFilterScope = GLOBAL_QUICK_FILTER_SCOPE) {
  const state = await readState(prisma, userId, scope)
  // Resolve all references in two batched queries, without counting matching artworks.
  const all = state.items.flatMap((i) => [...i.query.artist, ...i.query.excludedArtists])
  const tags = state.items.flatMap((i) => i.query.tags)
  const [artistsFound, tagsFound] = await Promise.all([
    prisma.artist.findMany({ where: { id: { in: all.map((a) => Number(a.value)) } }, select: { id: true } }),
    prisma.tag.findMany({ where: { id: { in: tags.map((t) => Number(t.value)) } }, select: { id: true } })
  ])
  const artistIds = new Set(artistsFound.map((a) => String(a.id)))
  const tagIds = new Set(tagsFound.map((t) => String(t.id)))
  return {
    ...state,
    items: state.items.map((item) => ({
      ...item,
      invalidReferences: [
        ...item.query.artist.filter((a) => !artistIds.has(a.value)).map((a) => `艺术家：${a.label}`),
        ...item.query.excludedArtists.filter((a) => !artistIds.has(a.value)).map((a) => `排除艺术家：${a.label}`),
        ...item.query.tags.filter((t) => !tagIds.has(t.value)).map((t) => `标签：${t.label}`)
      ]
    }))
  }
}
export async function createQuickFilter(
  userId: string,
  input: { name: string; query: ArtworkQuerySnapshot; pin: boolean; scope?: QuickFilterScope }
) {
  const scope = input.scope ?? GLOBAL_QUICK_FILTER_SCOPE
  return mutate(userId, scope, async (db, state) => {
    if (scope.kind === 'artist' && input.pin) fail('艺术家专属筛选不能加入全局导航')
    if (state.items.length >= 100) fail('最多保存 100 条快捷筛选')
    if (state.items.some((i) => i.name === input.name)) fail('已存在同名快捷筛选')
    if (scope.kind === 'artist') {
      if (!(await db.artist.findUnique({ where: { id: scope.artistId }, select: { id: true } })))
        {fail('艺术家不存在', 'NOT_FOUND')}
      if (input.query.artist.length) fail('艺术家专属筛选只保存附加条件')
    }
    if ((await invalidReferences(db, input.query)).length) fail('艺术家或标签已失效，请修改条件后保存')
    const item = {
      id: randomUUID(),
      schemaVersion: 1 as const,
      revision: 1,
      name: input.name,
      query: input.query,
      createdAt: new Date().toISOString()
    }
    await write(db, userId, scopePrefix(scope) + item.id, item)
    if (input.pin && state.navigation.ids.length < 10) {
      await write(db, userId, QUICK_FILTER_NAV_KEY, {
        revision: state.navigation.revision + 1,
        ids: [...state.navigation.ids, item.id]
      })
    }
    return item
  })
}
export async function updateQuickFilter(
  userId: string,
  input: { id: string; revision: number; name: string; query: ArtworkQuerySnapshot; scope?: QuickFilterScope }
) {
  const scope = input.scope ?? GLOBAL_QUICK_FILTER_SCOPE
  return mutate(userId, scope, async (db, state) => {
    const old = state.items.find((i) => i.id === input.id)
    if (!old) return fail('快捷筛选已被删除，请刷新列表', 'NOT_FOUND')
    if (old.revision !== input.revision) fail('其他设备已修改此筛选，请刷新后重新编辑；当前草稿仍保留', 'CONFLICT')
    if (state.items.some((i) => i.id !== old.id && i.name === input.name)) fail('已存在同名快捷筛选')
    if (scope.kind === 'artist') {
      if (!(await db.artist.findUnique({ where: { id: scope.artistId }, select: { id: true } })))
        {fail('艺术家不存在', 'NOT_FOUND')}
      if (input.query.artist.length) fail('艺术家专属筛选只保存附加条件')
    }
    if ((await invalidReferences(db, input.query)).length) fail('艺术家或标签已失效，请修改条件后保存')
    const item = { ...old, name: input.name, query: input.query, revision: old.revision + 1 }
    await write(db, userId, scopePrefix(scope) + old.id, item)
    return item
  })
}
export async function deleteQuickFilter(
  userId: string,
  input: { id: string; revision: number; scope?: QuickFilterScope }
) {
  const scope = input.scope ?? GLOBAL_QUICK_FILTER_SCOPE
  return mutate(userId, scope, async (db, state) => {
    const old = state.items.find((i) => i.id === input.id)
    if (!old) return fail('快捷筛选已被删除，请刷新列表', 'NOT_FOUND')
    if (old.revision !== input.revision) fail('其他设备已修改此筛选，请刷新后重试', 'CONFLICT')
    await db.userSetting.delete({ where: { userId_key: { userId, key: scopePrefix(scope) + old.id } } })
    if (state.navigation.ids.includes(old.id)) {
      await write(db, userId, QUICK_FILTER_NAV_KEY, {
        revision: state.navigation.revision + 1,
        ids: state.navigation.ids.filter((id) => id !== old.id)
      })
    }
  })
}
export async function setQuickFilterNavigation(
  userId: string,
  navigation: { revision: number; ids: string[] },
  scope: QuickFilterScope = GLOBAL_QUICK_FILTER_SCOPE
) {
  if (scope.kind !== 'global') fail('艺术家专属筛选不能加入全局导航')
  return mutate(userId, scope, async (db, state) => {
    if (state.navigation.revision !== navigation.revision) fail('导航顺序已在其他设备更改，请刷新后重试', 'CONFLICT')
    if (navigation.ids.some((id) => !state.items.some((i) => i.id === id))) {
      fail('快捷筛选已被删除，请刷新列表', 'CONFLICT')
    }
    await write(db, userId, QUICK_FILTER_NAV_KEY, { ids: navigation.ids, revision: navigation.revision + 1 })
  })
}

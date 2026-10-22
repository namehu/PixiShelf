import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTagManagementWhere, deleteTag, searchTags, updateTag } from '../tag-service'

const mocks = vi.hoisted(() => ({
  tagFindUniqueMock: vi.fn(),
  tagFindFirstMock: vi.fn(),
  tagFindManyMock: vi.fn(),
  tagUpdateMock: vi.fn(),
  tagDeleteMock: vi.fn(),
  queryRawMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRawMock,
    tag: {
      findUnique: mocks.tagFindUniqueMock,
      findFirst: mocks.tagFindFirstMock,
      findMany: mocks.tagFindManyMock,
      update: mocks.tagUpdateMock,
      delete: mocks.tagDeleteMock
    }
  }
}))

describe('tag management Pixiv enrichment filters', () => {
  const sourceCandidate = {
    namespace: 'general',
    isSystem: false,
    artworkTags: {
      some: {
        provenance: 'SOURCE',
        sourceRef: { is: { providerKey: 'pixiv' } }
      }
    }
  }

  it.each([
    ['NO_IDENTITY', { NOT: sourceCandidate }],
    ['UNCHECKED', { ...sourceCandidate, externalMetadata: { none: { providerKey: 'pixiv' } } }],
    ['CHECKED', { ...sourceCandidate, externalMetadata: { some: { providerKey: 'pixiv' } } }],
    ['SUCCESS', { ...sourceCandidate, externalMetadata: { some: { providerKey: 'pixiv', status: 'SUCCESS' } } }],
    ['PARTIAL', { ...sourceCandidate, externalMetadata: { some: { providerKey: 'pixiv', status: 'PARTIAL' } } }],
    ['NO_DATA', { ...sourceCandidate, externalMetadata: { some: { providerKey: 'pixiv', status: 'NO_DATA' } } }],
    ['FAILED', { ...sourceCandidate, externalMetadata: { some: { providerKey: 'pixiv', status: 'FAILED' } } }]
  ] as const)('builds the %s database predicate before pagination', (pixivStatus, condition) => {
    expect(buildTagManagementWhere({ translationStatus: 'all', pixivStatus })).toEqual({ AND: [condition] })
  })

  it('combines translation and Pixiv filters', () => {
    expect(
      buildTagManagementWhere({
        search: 'miku',
        translationStatus: 'untranslated',
        pixivStatus: 'PARTIAL'
      })
    ).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: 'miku', mode: 'insensitive' } },
            { name_zh: { contains: 'miku', mode: 'insensitive' } },
            { name_en: { contains: 'miku', mode: 'insensitive' } }
          ]
        },
        { AND: [{ name_zh: null }, { name_en: null }] },
        { ...sourceCandidate, externalMetadata: { some: { providerKey: 'pixiv', status: 'PARTIAL' } } }
      ]
    })
  })

  it('normalizes whitespace without adding a filter for an empty query', () => {
    expect(buildTagManagementWhere({ search: '  ', translationStatus: 'all' })).toEqual({})
    expect(buildTagManagementWhere({ search: '  猫  ', translationStatus: 'all' })).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: '猫', mode: 'insensitive' } },
            { name_zh: { contains: '猫', mode: 'insensitive' } },
            { name_en: { contains: '猫', mode: 'insensitive' } }
          ]
        }
      ]
    })
  })
})

describe('tag list multilingual search', () => {
  beforeEach(() => {
    mocks.queryRawMock.mockReset()
  })

  it.each([
    ['ねこ', 'ねこ:*'],
    ['猫咪', '猫咪:*'],
    ['CAT', 'CAT:*'],
    ['  Black   cat  ', 'Black:* & cat:*'],
    ["ねこ | !'猫':*", 'ねこ:* & 猫:*']
  ])('preserves the multilingual prefix query for %s', async (query, expectedQuery) => {
    const tag = { id: 17, name: 'ねこ', name_zh: '猫咪', name_en: 'Cat', relevance_score: 0.25 }
    mocks.queryRawMock.mockResolvedValueOnce([tag]).mockResolvedValueOnce([{ count: BigInt(3) }])

    const result = await searchTags({ query, page: 2, pageSize: 1 })

    const [resultTemplate, ...resultParams] = mocks.queryRawMock.mock.calls[0]!
    const resultSql = (resultTemplate as TemplateStringsArray).join('?')
    expect(resultSql).toContain('WHERE search_vector @@')
    expect(resultSql).toContain('DESC, id ASC')
    expect(resultSql).toContain('LIMIT ? OFFSET ?')
    expect(resultParams).toEqual([expectedQuery, expectedQuery, expectedQuery, 1, 1])
    expect(mocks.queryRawMock.mock.calls[1]?.slice(1)).toEqual([expectedQuery])
    expect(result).toEqual({ items: [{ ...tag, relevanceScore: 0.25 }], nextCursor: 3 })
  })

  it.each(['', ' \t\n ', '& | ! :*'])(
    'returns no results without querying for empty searchable input %j',
    async (query) => {
      await expect(searchTags({ query, page: 1, pageSize: 20 })).resolves.toEqual({ items: [], nextCursor: undefined })
      expect(mocks.queryRawMock).not.toHaveBeenCalled()
    }
  )

  it('ends pagination for no matches', async () => {
    mocks.queryRawMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: BigInt(0) }])

    await expect(searchTags({ query: '不存在', page: 1, pageSize: 20 })).resolves.toEqual({
      items: [],
      nextCursor: undefined
    })
  })
})

describe('tag-service system tag protection', () => {
  beforeEach(() => {
    mocks.tagFindUniqueMock.mockReset()
    mocks.tagFindFirstMock.mockReset().mockResolvedValue(null)
    mocks.tagFindManyMock.mockReset().mockResolvedValue([])
    mocks.tagUpdateMock.mockReset()
    mocks.tagDeleteMock.mockReset()
  })

  it('rejects deleting system tags', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: true })

    await expect(deleteTag(1)).rejects.toThrow('System tags cannot be deleted')
    expect(mocks.tagDeleteMock).not.toHaveBeenCalled()
  })

  it('rejects renaming system tags', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: true, name: 'video', name_zh: null, name_en: null })

    await expect(updateTag(1, { name: 'movie' })).rejects.toThrow('System tag name cannot be changed')
    expect(mocks.tagUpdateMock).not.toHaveBeenCalled()
  })

  it('allows updating system tag metadata without changing name', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: true, name: 'video' })
    mocks.tagUpdateMock.mockResolvedValue({ id: 1 })

    await updateTag(1, { name_zh: '视频' })

    expect(mocks.tagUpdateMock).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name_zh: '视频', translateType: 'MANUAL' }
    })
  })

  it('marks manual translations and returns to NONE only after both translations are cleared', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: false, name: 'tag', name_zh: '中文', name_en: 'English' })
    mocks.tagUpdateMock.mockResolvedValue({ id: 1 })

    await updateTag(1, { name_zh: null, name_en: null })

    expect(mocks.tagUpdateMock).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name_zh: null, name_en: null, translateType: 'NONE' }
    })
  })

  it('does not change translation ownership for a description-only edit', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: false, name: 'tag', name_zh: '中文', name_en: null })
    mocks.tagUpdateMock.mockResolvedValue({ id: 1 })

    await updateTag(1, { description: '  人工描述  ' })

    expect(mocks.tagUpdateMock).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { description: '人工描述' }
    })
  })

  it('preserves translation ownership when a form resubmits unchanged translation values', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: false, name: 'tag', name_zh: '中文', name_en: null })
    mocks.tagUpdateMock.mockResolvedValue({ id: 1 })

    await updateTag(1, { name_zh: '中文', name_en: null, description: '人工描述' })

    expect(mocks.tagUpdateMock).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name_zh: '中文', name_en: null, description: '人工描述' }
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTagManagementWhere, deleteTag, getUntranslatedTagNames, updateTag } from '../tag-service'

const mocks = vi.hoisted(() => ({
  tagFindUniqueMock: vi.fn(),
  tagFindFirstMock: vi.fn(),
  tagFindManyMock: vi.fn(),
  tagUpdateMock: vi.fn(),
  tagDeleteMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
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

  it('exports untranslated tags only when both translation fields are null', async () => {
    mocks.tagFindManyMock.mockResolvedValue([{ name: 'original' }])

    await expect(getUntranslatedTagNames()).resolves.toEqual(['original'])
    expect(mocks.tagFindManyMock).toHaveBeenCalledWith({
      where: { name_zh: null, name_en: null },
      select: { name: true }
    })
  })
})

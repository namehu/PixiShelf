import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteTag, updateTag } from './tag-service'

const mocks = vi.hoisted(() => ({
  tagFindUniqueMock: vi.fn(),
  tagFindFirstMock: vi.fn(),
  tagUpdateMock: vi.fn(),
  tagDeleteMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: {
      findUnique: mocks.tagFindUniqueMock,
      findFirst: mocks.tagFindFirstMock,
      update: mocks.tagUpdateMock,
      delete: mocks.tagDeleteMock
    }
  }
}))

describe('tag-service system tag protection', () => {
  beforeEach(() => {
    mocks.tagFindUniqueMock.mockReset()
    mocks.tagFindFirstMock.mockReset().mockResolvedValue(null)
    mocks.tagUpdateMock.mockReset()
    mocks.tagDeleteMock.mockReset()
  })

  it('rejects deleting system tags', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: true })

    await expect(deleteTag(1)).rejects.toThrow('System tags cannot be deleted')
    expect(mocks.tagDeleteMock).not.toHaveBeenCalled()
  })

  it('rejects renaming system tags', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: true, name: 'video' })

    await expect(updateTag(1, { name: 'movie' })).rejects.toThrow('System tag name cannot be changed')
    expect(mocks.tagUpdateMock).not.toHaveBeenCalled()
  })

  it('allows updating system tag metadata without changing name', async () => {
    mocks.tagFindUniqueMock.mockResolvedValue({ isSystem: true, name: 'video' })
    mocks.tagUpdateMock.mockResolvedValue({ id: 1 })

    await updateTag(1, { name_zh: '视频' })

    expect(mocks.tagUpdateMock).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name_zh: '视频' }
    })
  })
})

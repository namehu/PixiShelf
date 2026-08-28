import { beforeEach, describe, expect, it, vi } from 'vitest'

const { settingFindManyMock, settingUpsertMock, transactionMock } = vi.hoisted(() => ({
  settingFindManyMock: vi.fn(),
  settingUpsertMock: vi.fn(),
  transactionMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    setting: {
      findMany: settingFindManyMock,
      upsert: settingUpsertMock
    },
    $transaction: transactionMock
  }
}))

import { getSystemSettings, upsertSystemSettings } from '../setting.service'

describe('system setting service', () => {
  beforeEach(() => {
    settingFindManyMock.mockReset()
    settingUpsertMock.mockReset()
    transactionMock.mockReset()
    transactionMock.mockImplementation(async (operations) => Promise.all(operations))
  })

  it('returns default system settings when no persisted setting exists', async () => {
    settingFindManyMock.mockResolvedValue([])

    await expect(getSystemSettings()).resolves.toEqual({
      replace_default_tag_ids: [],
      local_import_default_tag_ids: [],
      archive_default_tag_ids: []
    })
  })

  it('encodes and decodes replace default tag ids as json', async () => {
    settingFindManyMock.mockResolvedValue([
      {
        key: 'replace_default_tag_ids',
        value: '[1,2,3]',
        type: 'json'
      },
      {
        key: 'local_import_default_tag_ids',
        value: '[4,5]',
        type: 'json'
      },
      {
        key: 'archive_default_tag_ids',
        value: '[6,7]',
        type: 'json'
      }
    ])
    settingUpsertMock.mockResolvedValue({})

    const result = await upsertSystemSettings({
      replace_default_tag_ids: [1, 2, 3],
      local_import_default_tag_ids: [4, 5],
      archive_default_tag_ids: [6, 7]
    })

    expect(settingUpsertMock).toHaveBeenCalledWith({
      where: { key: 'replace_default_tag_ids' },
      update: {
        value: '[1,2,3]',
        type: 'json'
      },
      create: {
        key: 'replace_default_tag_ids',
        value: '[1,2,3]',
        type: 'json'
      }
    })
    expect(settingUpsertMock).toHaveBeenCalledWith({
      where: { key: 'local_import_default_tag_ids' },
      update: {
        value: '[4,5]',
        type: 'json'
      },
      create: {
        key: 'local_import_default_tag_ids',
        value: '[4,5]',
        type: 'json'
      }
    })
    expect(settingUpsertMock).toHaveBeenCalledWith({
      where: { key: 'archive_default_tag_ids' },
      update: {
        value: '[6,7]',
        type: 'json'
      },
      create: {
        key: 'archive_default_tag_ids',
        value: '[6,7]',
        type: 'json'
      }
    })
    expect(result).toEqual({
      replace_default_tag_ids: [1, 2, 3],
      local_import_default_tag_ids: [4, 5],
      archive_default_tag_ids: [6, 7]
    })
  })

  it('does not clear archive defaults when an older client omits the new field', async () => {
    settingFindManyMock.mockResolvedValue([
      { key: 'replace_default_tag_ids', value: '[1]', type: 'json' },
      { key: 'local_import_default_tag_ids', value: '[2]', type: 'json' },
      { key: 'archive_default_tag_ids', value: '[3]', type: 'json' }
    ])
    settingUpsertMock.mockResolvedValue({})

    await expect(
      upsertSystemSettings({ replace_default_tag_ids: [1], local_import_default_tag_ids: [2] })
    ).resolves.toEqual({
      replace_default_tag_ids: [1],
      local_import_default_tag_ids: [2],
      archive_default_tag_ids: [3]
    })
    expect(settingUpsertMock).toHaveBeenCalledTimes(2)
    expect(settingUpsertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'archive_default_tag_ids' } })
    )
  })
})

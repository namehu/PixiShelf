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
      local_import_default_tag_ids: []
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
      }
    ])
    settingUpsertMock.mockResolvedValue({})

    const result = await upsertSystemSettings({
      replace_default_tag_ids: [1, 2, 3],
      local_import_default_tag_ids: [4, 5]
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
    expect(result).toEqual({
      replace_default_tag_ids: [1, 2, 3],
      local_import_default_tag_ids: [4, 5]
    })
  })
})

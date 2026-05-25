import { prisma } from '@/lib/prisma'
import { userSettingsSchema } from '@/schemas/user-setting.dto'
import type { SettingType, UpdateProfileDTO, UpdateUserSettingDTO, UserSettings } from '@/schemas/user-setting.dto'

function inferSettingType(value: UpdateUserSettingDTO['value']): SettingType {
  if (value === null) return 'string'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  return 'json'
}

function encodeSettingValue(value: UpdateUserSettingDTO['value']) {
  if (value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function decodeSettingValue(value: string | null, type: string): unknown {
  if (value === null) return null
  if (type === 'boolean') return value === 'true'
  if (type === 'number') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? value : parsed
  }
  if (type === 'json') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const settings: Array<{ key: string; value: string | null; type: string }> = await prisma.userSetting.findMany({
    where: { userId },
    select: {
      key: true,
      value: true,
      type: true
    }
  })

  const rawSettings = settings.reduce<Record<string, unknown>>((acc, item) => {
    acc[item.key] = decodeSettingValue(item.value, item.type)
    return acc
  }, {})

  return userSettingsSchema.parse(rawSettings)
}

export async function upsertUserSettings(userId: string, settings: UpdateUserSettingDTO[]) {
  if (settings.length === 0) return

  await prisma.$transaction(
    settings.map((item) => {
      const type = item.type ?? inferSettingType(item.value)
      return prisma.userSetting.upsert({
        where: {
          userId_key: {
            userId,
            key: item.key
          }
        },
        update: {
          value: encodeSettingValue(item.value),
          type
        },
        create: {
          userId,
          key: item.key,
          value: encodeSettingValue(item.value),
          type
        }
      })
    })
  )
}

export async function updateUserProfile(userId: string, data: UpdateProfileDTO) {
  return prisma.userBA.update({
    where: { id: userId },
    data: {
      name: data.name,
      image: data.image
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true
    }
  })
}

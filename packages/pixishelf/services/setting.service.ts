import { prisma } from '@/lib/prisma'
import { SYSTEM_SETTING_KEYS, systemSettingsWithDefaultsSchema, updateSystemSettingsSchema } from '@/schemas/system-setting.dto'
import type { SystemSettingsWithDefaults, UpdateSystemSettingsDTO } from '@/schemas/system-setting.dto'

type SettingValue = string | number | boolean | unknown[] | Record<string, unknown> | null
type SettingType = 'string' | 'boolean' | 'number' | 'json'

function inferSettingType(value: SettingValue): SettingType {
  if (value === null) return 'string'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  return 'json'
}

function encodeSettingValue(value: SettingValue) {
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

const systemSettingKeys = Object.values(SYSTEM_SETTING_KEYS)

/**
 * 根据 ID 获取单个艺术家
 * @param id 艺术家 ID
 * @returns 艺术家数据或 null
 */
export async function getScanPath(): Promise<string | null> {
  const setting = await prisma.setting.findUnique({
    where: { key: 'scanPath' }
  })

  return setting?.value || null
}

/**
 * 设置扫描路径
 * @param value 扫描路径
 */
export async function setScanPath(value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'scanPath' },
    update: { value },
    create: { key: 'scanPath', value }
  })
}

export async function getSystemSettings(): Promise<SystemSettingsWithDefaults> {
  const settings = await prisma.setting.findMany({
    where: {
      key: { in: systemSettingKeys }
    },
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

  return systemSettingsWithDefaultsSchema.parse(rawSettings)
}

export async function upsertSystemSettings(input: UpdateSystemSettingsDTO): Promise<SystemSettingsWithDefaults> {
  const settings = updateSystemSettingsSchema.parse(input)

  await prisma.$transaction(
    Object.entries(settings).map(([key, value]) => {
      const type = inferSettingType(value)
      return prisma.setting.upsert({
        where: { key },
        update: {
          value: encodeSettingValue(value),
          type
        },
        create: {
          key,
          value: encodeSettingValue(value),
          type
        }
      })
    })
  )

  return getSystemSettings()
}

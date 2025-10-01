import { prisma } from '@/lib/prisma'

export interface SettingValue {
  scanPath?: string
}

export class SettingService {
  constructor() {}

  async get(key: string): Promise<string | null> {
    const setting = await prisma.setting.findUnique({
      where: { key }
    })
    return setting?.value || null
  }

  async set(key: string, value: string, type: string = 'string'): Promise<void> {
    await prisma.setting.upsert({
      where: { key },
      update: { value, type },
      create: { key, value, type }
    })
  }

  async getScanPath(): Promise<string | null> {
    // 优先级：数据库设置 > 环境变量
    const dbValue = await this.get('scanPath')
    return dbValue || null
  }

  async setScanPath(value: string): Promise<void> {
    await this.set('scanPath', value, 'string')
  }

  async getAll(): Promise<Record<string, string>> {
    const settings = await prisma.setting.findMany()
    return settings.reduce(
      (acc, setting) => {
        acc[setting.key] = setting.value || ''
        return acc
      },
      {} as Record<string, string>
    )
  }

  async initDefaults(): Promise<void> {}
}

// 单例实例
let settingServiceInstance: SettingService | null = null

/**
 * 获取 SettingService 实例
 */
export function getSettingService(): SettingService {
  if (!settingServiceInstance) {
    settingServiceInstance = new SettingService()
  }
  return settingServiceInstance
}

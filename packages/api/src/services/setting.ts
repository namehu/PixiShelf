import { PrismaClient } from '@prisma/client'

export interface SettingValue {
  scanPath?: string
}

export class SettingService {
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.setting.findUnique({
      where: { key }
    })
    return setting?.value || null
  }

  async set(key: string, value: string, type: string = 'string'): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value, type },
      create: { key, value, type }
    })
  }

  async getScanPath(): Promise<string | null> {
    // 优先级：数据库设置 > 环境变量
    const dbValue = await this.get('scanPath')
    return dbValue || process.env.SCAN_PATH || null
  }

  async setScanPath(value: string): Promise<void> {
    await this.set('scanPath', value, 'string')
  }

  async getAll(): Promise<Record<string, string>> {
    const settings = await this.prisma.setting.findMany()
    return settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value || ''
      return acc
    }, {} as Record<string, string>)
  }

  async initDefaults(): Promise<void> {
    // 如果数据库中没有 scanPath 但环境变量有，则自动迁移
    const dbScanPath = await this.get('scanPath')
    if (!dbScanPath && process.env.SCAN_PATH) {
      await this.setScanPath(process.env.SCAN_PATH)
    }
  }
}
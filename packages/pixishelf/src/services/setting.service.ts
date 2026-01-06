import { prisma } from '@/lib/prisma'

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

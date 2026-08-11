import { prisma } from '@/lib/prisma'
import { ArchiveError } from './errors'

export async function requireArchiveStorageRoot(): Promise<string> {
  const configured = process.env.ARCHIVE_STORAGE_PATH?.trim()
  if (configured) return configured
  const setting = await prisma.setting.findUnique({ where: { key: 'scanPath' }, select: { value: true } })
  if (!setting?.value) throw new ArchiveError('INTERNAL', '请先配置归档存储根目录')
  return setting.value
}

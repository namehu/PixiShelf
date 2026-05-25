import { prisma } from '@/lib/prisma'

export async function hasUsers(): Promise<boolean> {
  const count = await prisma.userBA.count()
  return count > 0
}

export async function hasAdmin(): Promise<boolean> {
  const count = await prisma.userBA.count()
  return count > 0
}

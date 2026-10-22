import type { Prisma } from '@prisma/client'

export function buildTagNameSearchWhere(query: string): Prisma.TagWhereInput | undefined {
  const search = query.trim()
  if (!search) return undefined

  return {
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { name_zh: { contains: search, mode: 'insensitive' } },
      { name_en: { contains: search, mode: 'insensitive' } }
    ]
  }
}

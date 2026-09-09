import 'server-only'

import { prisma } from '@/lib/prisma'

/** Only the frozen gallery identity may leave the application through the source redirect. */
export function archiveTaskSourceUrl(task: {
  providerKey: string
  externalId: string
  canonicalUrl: string
}): string | null {
  if (task.providerKey !== 'e-hentai') return null
  try {
    const url = new URL(task.canonicalUrl)
    const gallery = url.pathname.match(/^\/g\/([1-9]\d*)\/([a-z0-9]+)\/$/i)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'e-hentai.org' ||
      url.port ||
      url.username ||
      url.password ||
      !gallery ||
      gallery[1] !== task.externalId
    ) {
      return null
    }
    return `https://e-hentai.org/g/${gallery[1]}/${gallery[2]}/`
  } catch {
    return null
  }
}

export async function getArchiveTaskSourceUrl(taskId: string): Promise<string | null> {
  const task = await prisma.archiveImport.findUnique({
    where: { id: taskId },
    select: { providerKey: true, externalId: true, canonicalUrl: true }
  })
  return task ? archiveTaskSourceUrl(task) : null
}

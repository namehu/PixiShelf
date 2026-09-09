interface PublishedArchiveTask {
  status: string
  publishedArtwork?: {
    id: number
    archiveLifecycleState?: string | null
    deletedAt?: unknown
  } | null
}

export function archiveTaskArtworkHref(task: PublishedArchiveTask): string | null {
  const artwork = task.publishedArtwork
  return task.status === 'COMPLETED' && artwork?.archiveLifecycleState === 'ACTIVE' && artwork.deletedAt === null
    ? `/artworks/${artwork.id}`
    : null
}

export function archiveTaskSourceHref(taskId: string): string {
  return `/api/archive/tasks/${encodeURIComponent(taskId)}/source`
}

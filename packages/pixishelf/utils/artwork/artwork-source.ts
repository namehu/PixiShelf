import type { ArtworkSource } from '@/schemas/models'

export function isLocalDirectoryArtworkSource(source: ArtworkSource) {
  return source === 'LOCAL_CREATED' || source === 'LOCAL_IMPORT'
}

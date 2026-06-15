import { ESource } from '@/enums/ESource'
import type { ArtworkSource } from '@/schemas/models'

export function isLocalDirectoryArtworkSource(source: ArtworkSource) {
  return source === ESource.LOCAL_CREATED || source === ESource.LOCAL_IMPORT
}

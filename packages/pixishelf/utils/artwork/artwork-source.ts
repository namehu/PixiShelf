import { ESource } from '@/enums/e-source'
import type { ArtworkSource } from '@/schemas/models'

export function isLocalDirectoryArtworkSource(source: ArtworkSource) {
  return source === ESource.LOCAL_CREATED || source === ESource.LOCAL_IMPORT
}

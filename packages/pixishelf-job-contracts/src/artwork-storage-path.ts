export type CanonicalArtworkCreationMethod =
  | 'UNKNOWN'
  | 'PIXIV_SCAN'
  | 'URL_ARCHIVE'
  | 'LOCAL_DIRECTORY'
  | 'MANUAL_CREATE'

export interface CanonicalArtworkStoragePathInput {
  createdVia: CanonicalArtworkCreationMethod
  artistId: number | null
  artistPixivExternalId: string | null
  artworkPixivExternalId: string | null
  storageKey: string | null
}

const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function resolveCanonicalArtworkStoragePath(input: CanonicalArtworkStoragePathInput): string | null {
  if (input.createdVia === 'PIXIV_SCAN') {
    if (!input.artistPixivExternalId || !input.artworkPixivExternalId) return null
    return `${safeSegment(input.artistPixivExternalId)}/${safeSegment(input.artworkPixivExternalId)}`
  }
  if (input.createdVia === 'LOCAL_DIRECTORY' || input.createdVia === 'MANUAL_CREATE') {
    if (input.createdVia === 'MANUAL_CREATE' && input.artistId === null && input.storageKey) {
      return `local-imports/unassigned/${safeSegment(input.storageKey)}`
    }
    if (!Number.isSafeInteger(input.artistId) || (input.artistId ?? 0) <= 0 || !input.storageKey) return null
    return `local-imports/artist-${input.artistId}/${safeSegment(input.storageKey)}`
  }
  return null
}

function safeSegment(value: string): string {
  if (
    value.length === 0 ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    [...value].some((character) => character.charCodeAt(0) <= 0x1f) ||
    /[<>:"/\\|?*]/.test(value) ||
    /[. ]$/.test(value) ||
    WINDOWS_RESERVED_SEGMENT.test(value)
  ) {
    throw new Error('Canonical artwork storage path contains an unsafe segment')
  }
  return value
}

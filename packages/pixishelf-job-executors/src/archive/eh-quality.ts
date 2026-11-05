export type EhDeliveredQuality = 'ORIGINAL' | 'DISPLAY' | 'UNKNOWN'

export interface EhMediaFacts {
  byteCount: bigint | number
  width: number
  height: number
  mimeType: string
  sha1?: string
}

export type EhOriginalClaim = {
  width: number
  height: number
  mimeType?: string | undefined
  minBytes: number
  maxBytes: number
}

interface HathDescriptor {
  sha1: string
  byteCount: number
  width: number
  height: number
  mimeType: string
}

const formats: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  wbp: 'image/webp',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp'
}
const displayResolutions = new Set(['780', '800', '980', '1280', '1600', '2400'])

export function isEhOriginalEndpoint(input: string | URL): boolean {
  const url = typeof input === 'string' ? new URL(input) : input
  return (
    url.protocol === 'https:' &&
    url.hostname === 'e-hentai.org' &&
    !url.port &&
    !url.username &&
    !url.password &&
    (url.pathname === '/fullimg.php' || /^\/fullimg\/.+/.test(url.pathname))
  )
}

/** Parse only known H@H descriptor positions, never filenames or arbitrary hash-like URLs. */
export function parseEhDeliveryUrl(input: string): {
  quality: EhDeliveredQuality
  reason: string
  descriptor?: HathDescriptor
  /** The first classifier treated these path cases as conflicting xres evidence. */
  legacyXresConflict?: boolean
} {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { quality: 'UNKNOWN', reason: 'INVALID_DELIVERY_URL' }
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.endsWith('.hath.network')) {
    return { quality: 'UNKNOWN', reason: 'NO_TRUSTED_HATH_EVIDENCE' }
  }
  const parts = url.pathname.split('/')
  const original = parseDescriptor(parts[parts[1] === 'om' ? 3 : 2])
  if (parts[1] === 'om' && /^\d+$/.test(parts[2] ?? '') && original && parts.length > 5) {
    if (parts[4] === 'x') return { quality: 'ORIGINAL', reason: 'HATH_OM_ORIGINAL', descriptor: original }
    const delivered = parseDescriptor(parts[4])
    if (!delivered) return { quality: 'UNKNOWN', reason: 'INVALID_HATH_DELIVERED_DESCRIPTOR' }
    if (original.sha1 !== delivered.sha1) {
      return { quality: 'DISPLAY', reason: 'HATH_OM_DERIVATIVE', descriptor: delivered }
    }
    if (
      original.byteCount === delivered.byteCount &&
      original.width === delivered.width &&
      original.height === delivered.height &&
      original.mimeType === delivered.mimeType
    ) {
      return { quality: 'ORIGINAL', reason: 'HATH_OM_IDENTICAL_ORIGINAL', descriptor: delivered }
    }
    return { quality: 'UNKNOWN', reason: 'CONFLICTING_HATH_DESCRIPTORS', descriptor: delivered }
  }
  if (parts[1] === 'h' && original && parts.length > 3) {
    const pathXres = parts[3]!
      .split(';')
      .filter((part) => part.startsWith('xres='))
      .map((part) => part.slice(5))
    const query = url.searchParams.getAll('xres')
    const unknown = { quality: 'UNKNOWN' as const, descriptor: original }
    if (new Set([...pathXres, ...query]).size > 1) return { ...unknown, reason: 'CONFLICTING_HATH_XRES' }
    if (pathXres.length > 1) return { ...unknown, reason: 'DUPLICATE_HATH_XRES', legacyXresConflict: true }
    const xres = pathXres[0]
    if (xres === undefined) {
      return { ...unknown, reason: 'HATH_H_WITHOUT_EXPLICIT_XRES', legacyXresConflict: query.length > 0 }
    }
    if (xres === 'org') return { quality: 'ORIGINAL', reason: 'HATH_H_XRES_ORIGINAL', descriptor: original }
    if (!displayResolutions.has(xres)) {
      return { ...unknown, reason: 'HATH_H_UNSUPPORTED_XRES', legacyXresConflict: true }
    }
    if (original.width !== Number(xres)) {
      return { ...unknown, reason: 'HATH_H_XRES_WIDTH_MISMATCH', legacyXresConflict: true }
    }
    return {
      quality: 'DISPLAY',
      reason: 'HATH_H_XRES_DISPLAY',
      descriptor: original,
      legacyXresConflict: xres === '800'
    }
  }
  return { quality: 'UNKNOWN', reason: 'UNSUPPORTED_HATH_PATH' }
}

/** Shared by online downloads and historical audit: claims must agree with received files. */
export function classifyEhDelivery(
  input: {
    url: string
    actual: EhMediaFacts
    /** Request provenance only; an original endpoint does not prove the received bytes. */
    originalResponse?: boolean
    originalClaim?: EhOriginalClaim
    /** Same-page original declaration collected during a display download for comparison. */
    sourceOriginalClaim?: EhOriginalClaim
    responseMimeType?: string | null
  },
  policy?: 'legacy-xres'
): { quality: EhDeliveredQuality; reason: string } {
  const evidence = parseEhDeliveryUrl(input.url)
  const replayLegacyConflict = policy === 'legacy-xres' && evidence.legacyXresConflict
  const quality = replayLegacyConflict ? 'UNKNOWN' : evidence.quality
  const reason = replayLegacyConflict ? 'CONFLICTING_HATH_XRES' : evidence.reason
  const descriptor = evidence.descriptor
  if (
    descriptor &&
    (BigInt(descriptor.byteCount) !== BigInt(input.actual.byteCount) ||
      descriptor.width !== input.actual.width ||
      descriptor.height !== input.actual.height ||
      descriptor.mimeType !== input.actual.mimeType ||
      (input.actual.sha1 !== undefined && descriptor.sha1 !== input.actual.sha1.toLowerCase()))
  ) {
    return { quality: 'UNKNOWN', reason: 'DELIVERED_FILE_CONFLICTS_WITH_DESCRIPTOR' }
  }
  const responseMimeType = input.responseMimeType?.split(';')[0]?.trim().toLowerCase()
  if (
    responseMimeType &&
    responseMimeType !== 'application/octet-stream' &&
    responseMimeType !== input.actual.mimeType
  ) {
    return { quality: 'UNKNOWN', reason: 'RESPONSE_MIME_CONFLICTS_WITH_FILE' }
  }
  if (quality === 'DISPLAY') return { quality, reason }
  const claimMatches = input.originalClaim && matchesOriginalClaim(input.originalClaim, input.actual)
  if (input.originalClaim && !claimMatches) {
    return { quality: 'UNKNOWN', reason: 'ORIGINAL_DECLARATION_CONFLICTS_WITH_FILE' }
  }
  if (quality === 'ORIGINAL') return { quality, reason }
  if (
    reason === 'HATH_H_XRES_WIDTH_MISMATCH' &&
    input.actual.sha1 !== undefined &&
    input.sourceOriginalClaim &&
    !matchesOriginalClaim(input.sourceOriginalClaim, input.actual)
  ) {
    return { quality: 'DISPLAY', reason: 'EH_DISPLAY_DIFFERS_FROM_ORIGINAL_DECLARATION' }
  }
  if (evidence.legacyXresConflict || reason.startsWith('CONFLICTING_') || reason.startsWith('INVALID_')) {
    return { quality, reason }
  }
  if (claimMatches) {
    const destination = new URL(input.url)
    const hath = destination.hostname.endsWith('.hath.network')
    const allowedHost =
      hath ||
      destination.hostname === 'e-hentai.org' ||
      destination.hostname.endsWith('.e-hentai.org') ||
      destination.hostname === 'ehgt.org' ||
      destination.hostname.endsWith('.ehgt.org')
    if (
      destination.protocol === 'https:' &&
      !destination.username &&
      !destination.password &&
      allowedHost &&
      (!destination.port || hath)
    ) {
      return { quality: 'ORIGINAL', reason: 'EH_EXPLICIT_ORIGINAL_METADATA_MATCH' }
    }
  }
  return { quality, reason }
}

function matchesOriginalClaim(claim: EhOriginalClaim, actual: EhMediaFacts): boolean {
  const byteCount = BigInt(actual.byteCount)
  return (
    claim.width === actual.width &&
    claim.height === actual.height &&
    (!claim.mimeType || claim.mimeType === actual.mimeType) &&
    byteCount >= BigInt(claim.minBytes) &&
    byteCount <= BigInt(claim.maxBytes)
  )
}

/** E-Hentai renders original size with a rounded unit; keep the displayed precision as an interval. */
export function parseEhOriginalClaim(text: string, filename: string | null): EhOriginalClaim | undefined {
  const match = text
    .replace(/<[^>]*>/g, ' ')
    .match(
      /Download\s+original\s+([1-9]\d*)\s*[x×]\s*([1-9]\d*)\s+([\d]+(?:\.\d+)?)\s*(B|bytes|KiB|MiB|GiB|KB|MB|GB)\b/i
    )
  if (!match) return undefined
  const unit = match[4]!.toLowerCase()
  const multiplier = (
    { b: 1, bytes: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, kb: 1000, mb: 1000 ** 2, gb: 1000 ** 3 } as Record<
      string,
      number
    >
  )[unit]!
  const precision = match[3]!.split('.')[1]?.length ?? 0
  const size = Number(match[3]) * multiplier
  const halfUnit = multiplier === 1 ? 0 : multiplier / 10 ** precision / 2
  const minBytes = Math.max(1, Math.ceil(size - halfUnit))
  const maxBytes = Math.floor(size + halfUnit)
  const width = Number(match[1]),
    height = Number(match[2])
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    size <= 0 ||
    !Number.isSafeInteger(maxBytes) ||
    minBytes > maxBytes
  ) {
    return undefined
  }
  const extension = filename?.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = formats[extension]
  return {
    width,
    height,
    minBytes,
    maxBytes,
    ...(mimeType ? { mimeType } : {})
  }
}

function parseDescriptor(input: string | undefined): HathDescriptor | undefined {
  const match = input?.match(/^([a-f0-9]{40})-([1-9]\d*)-([1-9]\d*)-([1-9]\d*)-([a-z0-9]+)$/i)
  if (!match) return undefined
  const mimeType = formats[match[5]!.toLowerCase()]
  const values = [match[2], match[3], match[4]].map(Number)
  if (!mimeType || values.some((value) => !Number.isSafeInteger(value) || value <= 0)) return undefined
  return { sha1: match[1]!.toLowerCase(), byteCount: values[0]!, width: values[1]!, height: values[2]!, mimeType }
}

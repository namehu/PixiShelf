import { compareCodePoints } from './stable-order.ts'

export type ScanMetadataFormat = 'json' | 'txt'

export interface ScanMetadata {
  id: string
  user: string
  userId: string
  title: string
  description: string | null
  tags: string[]
  url: string | null
  original: string | null
  thumbnail: string | null
  xRestrict: string | null
  isAiGenerated: boolean | null
  size: string | null
  bookmarkCount: number | null
  sourceDate: Date | null
  metadataFormat: ScanMetadataFormat
  rawMetadataJson: unknown | null
  pixivAiType: number | null
  pixivType: number | null
  sanityLevel: number | null
}

export interface MetadataCandidate {
  artworkId: string
  format: ScanMetadataFormat
  relativePath: string
  absolutePath: string
}

export function metadataCandidateFromPath(input: {
  relativePath: string
  absolutePath: string
}): MetadataCandidate | null {
  const filename = input.relativePath.split('/').at(-1) ?? ''
  const match = filename.match(/^(\d+)(?:_p\d+)?-meta\.(json|txt)$/i)
  if (!match?.[1] || !match[2]) return null
  return {
    artworkId: match[1],
    format: match[2].toLowerCase() as ScanMetadataFormat,
    relativePath: input.relativePath,
    absolutePath: input.absolutePath
  }
}

export function selectPreferredMetadataCandidates(candidates: readonly MetadataCandidate[]): MetadataCandidate[] {
  const selected = new Map<string, MetadataCandidate>()
  for (const candidate of candidates) {
    const current = selected.get(candidate.artworkId)
    if (!current || compareCandidate(candidate, current) < 0) selected.set(candidate.artworkId, candidate)
  }
  return [...selected.values()].sort((left, right) => compareCodePoints(left.relativePath, right.relativePath))
}

export function parseMetadataDocument(content: string, format: ScanMetadataFormat): ScanMetadata {
  const parsed = format === 'json' ? parseJsonDocument(content) : parseTextDocument(content)
  const id = requiredNumericString(parsed.id, 'ID')
  const userId = requiredNumericString(parsed.userId, 'UserID')
  const user = requiredString(parsed.user, 'User')
  const title = requiredString(parsed.title, 'Title')
  return {
    id,
    user,
    userId,
    title,
    description: optionalString(parsed.description),
    tags: normalizeTags(parsed.tags),
    url: optionalString(parsed.url) ?? (format === 'json' ? `https://www.pixiv.net/artworks/${id}` : null),
    original: optionalString(parsed.original),
    thumbnail: optionalString(parsed.thumbnail),
    xRestrict: optionalString(parsed.xRestrict),
    isAiGenerated: normalizeAi(parsed.aiType ?? parsed.ai),
    size: normalizeSize(parsed),
    bookmarkCount: optionalInteger(parsed.bookmark ?? parsed.bmk),
    sourceDate: optionalDate(parsed.date ?? parsed.uploadDate),
    metadataFormat: format,
    rawMetadataJson: format === 'json' ? parsed.raw : null,
    pixivAiType: optionalInteger(parsed.aiType),
    pixivType: optionalInteger(parsed.type),
    sanityLevel: optionalInteger(parsed.sl)
  }
}

function parseJsonDocument(content: string): Record<string, unknown> & { raw: unknown } {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('Metadata JSON is invalid')
  }
  if (!isRecord(raw)) throw new Error('Metadata JSON must be an object')
  const id = normalizeJsonArtworkId(raw.idNum ?? raw.id)
  return {
    ...raw,
    id,
    userId: raw.userId,
    thumbnail: raw.thumb ?? raw.thumbnail ?? raw.small ?? raw.regular,
    raw
  }
}

function parseTextDocument(content: string): Record<string, unknown> & { raw: null } {
  const parsed: Record<string, string> = {}
  let key: string | null = null
  let value: string[] = []
  const flush = () => {
    if (key && value.length > 0) parsed[key] = value.join('\n').trim()
    key = null
    value = []
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (TEXT_KEYS.has(trimmed)) {
      flush()
      key = trimmed
    } else if (!trimmed) {
      flush()
    } else if (key) {
      value.push(trimmed)
    }
  }
  flush()
  return {
    id: parsed.ID,
    user: parsed.User,
    userId: parsed.UserID,
    title: parsed.Title,
    description: parsed.Description,
    tags: parsed.Tags,
    url: parsed.URL,
    original: parsed.Original,
    thumbnail: parsed.Thumbnail,
    xRestrict: parsed.xRestrict,
    ai: parsed.AI,
    size: parsed.Size,
    bookmark: parsed.Bookmark,
    date: parsed.Date,
    raw: null
  }
}

const TEXT_KEYS = new Set([
  'ID',
  'User',
  'UserID',
  'Title',
  'Description',
  'Tags',
  'URL',
  'Original',
  'Thumbnail',
  'xRestrict',
  'AI',
  'Size',
  'Bookmark',
  'Date'
])

function compareCandidate(left: MetadataCandidate, right: MetadataCandidate): number {
  if (left.format !== right.format) return left.format === 'json' ? -1 : 1
  return compareCodePoints(left.relativePath, right.relativePath)
}

function normalizeJsonArtworkId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  if (typeof value !== 'string') return ''
  return value.match(/^(\d+)(?:_p\d+)?$/i)?.[1] ?? ''
}

function requiredNumericString(value: unknown, field: string): string {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : optionalString(value)
  if (!normalized || !/^\d+$/.test(normalized)) throw new Error(`Metadata ${field} must be a numeric string`)
  return normalized
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value)
  if (!normalized) throw new Error(`Metadata ${field} is required`)
  return normalized
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized || null
}

function optionalInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function optionalDate(value: unknown): Date | null {
  const text = optionalString(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : []
  return [...new Set(values.map((tag) => String(tag).trim().replace(/^#/, '')).filter(Boolean))]
}

function normalizeAi(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null
  return !(value === false || value === 0 || String(value).toLowerCase() === 'no')
}

function normalizeSize(value: Record<string, unknown>): string | null {
  const explicit = optionalString(value.size)
  if (explicit) return explicit
  const width = optionalInteger(value.fullWidth)
  const height = optionalInteger(value.fullHeight)
  return width && height ? `${width} x ${height}` : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { resolveExistingPathWithinRoot } from './paths.js'
import { VideoProcessingPermanentError } from './types.js'

const MAX_MANIFEST_BYTES = 5 * 1024 * 1024
const MAX_MANIFEST_CHAPTERS = 1_000

export interface VideoChapter {
  index: number
  title: string
  start: number
  end: number
  duration: number
  [key: string]: unknown
}

export interface VideoChapterManifest {
  version: 1 | 2
  duration: number
  chapters: VideoChapter[]
  [key: string]: unknown
}

export async function readChapterManifest(root: string, storedPath: string) {
  const manifestPath = await resolveExistingPathWithinRoot(root, storedPath)
  const stat = await fs.stat(manifestPath)
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
    throw new VideoProcessingPermanentError('INVALID_CHAPTER_MANIFEST', 'Chapter manifest is not a valid file')
  }
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch {
    throw new VideoProcessingPermanentError('INVALID_CHAPTER_MANIFEST', 'Chapter manifest contains invalid JSON')
  }
  return parseChapterManifest(value)
}

export function createChapterManifestHash(manifest: VideoChapterManifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

function parseChapterManifest(value: unknown): VideoChapterManifest {
  if (!isRecord(value) || !Array.isArray(value.chapters)) invalidManifest()
  if (value.version !== 1 && value.version !== 2) invalidManifest()
  const duration = numberValue(value.duration)
  if (duration <= 0 || value.chapters.length === 0 || value.chapters.length > MAX_MANIFEST_CHAPTERS) {
    invalidManifest()
  }
  assertOptional(value, ['generatedAt', 'video', 'outputPath'], (entry) => typeof entry === 'string')
  assertOptional(value, ['inputCount'], (entry) => Number.isInteger(entry) && Number(entry) >= 0)
  assertOptional(value, ['hasAudio'], (entry) => typeof entry === 'boolean')
  assertOptional(value, ['output', 'canvas', 'transition'], isRecord)
  const chapters = value.chapters.map((entry) => {
    if (!isRecord(entry)) invalidManifest()
    const start = numberValue(entry.start)
    const end = numberValue(entry.end)
    const chapterDuration = numberValue(entry.duration)
    const index = Number(entry.index)
    if (!Number.isInteger(index) || index <= 0 || start < 0 || end <= start) invalidManifest()
    if (Math.abs(chapterDuration - (end - start)) >= 0.05) invalidManifest()
    if (entry.title !== undefined && typeof entry.title !== 'string') invalidManifest()
    assertOptional(entry, ['file'], (nested) => typeof nested === 'string')
    assertOptional(entry, ['source', 'video', 'audio', 'processing'], isRecord)
    const title = (typeof entry.title === 'string' ? entry.title : '').trim() || `Chapter ${index}`
    return orderedChapter(entry, { index, title, start, end, duration: chapterDuration })
  })
  for (let index = 1; index < chapters.length; index += 1) {
    if (chapters[index]!.start < chapters[index - 1]!.end) invalidManifest()
  }
  return orderedManifest(value, { version: value.version, duration, chapters })
}

function orderedChapter(
  source: Record<string, unknown>,
  required: Pick<VideoChapter, 'index' | 'title' | 'start' | 'end' | 'duration'>
): VideoChapter {
  return {
    index: required.index,
    title: required.title,
    start: required.start,
    end: required.end,
    duration: required.duration,
    ...optional(source, ['file', 'source', 'video', 'audio', 'processing']),
    ...extras(source, ['index', 'title', 'start', 'end', 'duration', 'file', 'source', 'video', 'audio', 'processing'])
  }
}

function orderedManifest(
  source: Record<string, unknown>,
  required: Pick<VideoChapterManifest, 'version' | 'duration' | 'chapters'>
): VideoChapterManifest {
  return {
    version: required.version,
    duration: required.duration,
    ...optional(source, [
      'generatedAt',
      'video',
      'outputPath',
      'inputCount',
      'hasAudio',
      'output',
      'canvas',
      'transition'
    ]),
    chapters: required.chapters,
    ...extras(source, [
      'version',
      'duration',
      'generatedAt',
      'video',
      'outputPath',
      'inputCount',
      'hasAudio',
      'output',
      'canvas',
      'transition',
      'chapters'
    ])
  }
}

function optional(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])))
}

function extras(source: Record<string, unknown>, known: string[]) {
  const knownKeys = new Set(known)
  return Object.fromEntries(Object.entries(source).filter(([key]) => !knownKeys.has(key)))
}

function assertOptional(source: Record<string, unknown>, keys: string[], predicate: (value: unknown) => boolean) {
  for (const key of keys) {
    if (source[key] !== undefined && !predicate(source[key])) invalidManifest()
  }
}

function invalidManifest(): never {
  throw new VideoProcessingPermanentError('INVALID_CHAPTER_MANIFEST', 'Chapter manifest has invalid chapter bounds')
}

function numberValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidManifest()
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

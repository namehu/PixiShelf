export const AUDIO_SAMPLE_SECONDS = 10
export const SHORT_CHAPTER_FULL_SCAN_SECONDS = 20
export const AUDIBLE_MAX_VOLUME_THRESHOLD_DB = -50
export const MAX_AUDIO_CHAPTERS = 1_000

export interface AudioSampleWindow {
  start: number
  duration: number
}

export interface AudioChapterBounds {
  index: number
  start: number
  end: number
  duration: number
}

export interface AudioChapterSamplePlan extends AudioChapterBounds {
  chapterOrder: number
  windows: AudioSampleWindow[]
}

export interface CompanionAudioManifest {
  version: 1 | 2 | 3
  duration: number
  hasAudio?: boolean
  chapters: AudioChapterBounds[]
}

export function parseCompanionAudioManifest(
  value: unknown,
  expectedVideoFileName: string
): CompanionAudioManifest | null {
  if (!isRecord(value) || value.video !== expectedVideoFileName || !Array.isArray(value.chapters)) return null
  if (value.version !== 1 && value.version !== 2 && value.version !== 3) return null
  if (!isPositiveFinite(value.duration) || value.chapters.length === 0 || value.chapters.length > MAX_AUDIO_CHAPTERS) {
    return null
  }

  const chapters: AudioChapterBounds[] = []
  for (const entry of value.chapters) {
    if (!isRecord(entry)) return null
    const index = entry.index
    const start = entry.start
    const end = entry.end
    const duration = entry.duration
    if (
      !Number.isInteger(index) ||
      Number(index) <= 0 ||
      !isNonnegativeFinite(start) ||
      !isPositiveFinite(end) ||
      !isPositiveFinite(duration) ||
      Number(end) <= Number(start) ||
      Math.abs(Number(duration) - (Number(end) - Number(start))) >= 0.05
    ) {
      return null
    }
    chapters.push({ index: Number(index), start: Number(start), end: Number(end), duration: Number(duration) })
  }

  for (let index = 1; index < chapters.length; index += 1) {
    if (chapters[index]!.start < chapters[index - 1]!.end) return null
  }
  if (chapters.at(-1)!.end > Number(value.duration) + 0.05) return null

  return {
    version: value.version,
    duration: Number(value.duration),
    ...(typeof value.hasAudio === 'boolean' ? { hasAudio: value.hasAudio } : {}),
    chapters
  }
}

export function buildChapterAudioSamplePlans(chapters: readonly AudioChapterBounds[]): AudioChapterSamplePlan[] {
  return chapters.map((chapter, chapterOrder) => ({
    ...chapter,
    chapterOrder,
    windows: buildChapterAudioSampleWindows(chapter.start, chapter.end)
  }))
}

export function buildChapterAudioSampleWindows(start: number, end: number): AudioSampleWindow[] {
  const duration = end - start
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || duration <= 0) return []
  if (duration <= SHORT_CHAPTER_FULL_SCAN_SECONDS) return [{ start, duration }]

  const first = centeredWindow(start + duration * 0.25, start, end)
  const second = centeredWindow(start + duration * 0.75, start, end)
  return Math.abs(first.start - second.start) < 0.001 ? [first] : [first, second]
}

export function buildUnchapteredAudioSampleWindows(duration: number | null): AudioSampleWindow[] {
  if (duration === null || duration <= 0) return [{ start: 0, duration: AUDIO_SAMPLE_SECONDS }]
  const windowDuration = Math.min(duration, AUDIO_SAMPLE_SECONDS)
  const starts = [0, Math.max(0, duration / 2 - windowDuration / 2), Math.max(0, duration - windowDuration)]
  return starts
    .filter((start, index) => index === 0 || Math.abs(start - starts[index - 1]!) >= 0.001)
    .map((start) => ({ start, duration: windowDuration }))
}

export function parseVolumedetectMaxVolume(stderr: string): number | null {
  const match = stderr.match(/max_volume:\s*(-inf|-?(?:\d+(?:\.\d+)?|\.\d+))\s*dB/i)
  if (!match) return null
  if (match[1]!.toLowerCase() === '-inf') return Number.NEGATIVE_INFINITY
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export function isAudibleMaxVolume(maxVolume: number) {
  return maxVolume > AUDIBLE_MAX_VOLUME_THRESHOLD_DB
}

function centeredWindow(center: number, chapterStart: number, chapterEnd: number): AudioSampleWindow {
  const latestStart = chapterEnd - AUDIO_SAMPLE_SECONDS
  const start = Math.min(Math.max(center - AUDIO_SAMPLE_SECONDS / 2, chapterStart), latestStart)
  return { start, duration: AUDIO_SAMPLE_SECONDS }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

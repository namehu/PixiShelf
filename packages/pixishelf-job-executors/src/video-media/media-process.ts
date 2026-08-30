import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  buildChapterAudioSamplePlans,
  buildUnchapteredAudioSampleWindows,
  isAudibleMaxVolume,
  parseCompanionAudioManifest,
  parseVolumedetectMaxVolume,
  type AudioSampleWindow
} from '../video-audio/detection.ts'
import { createChapterManifestHash, parseChapterManifest } from '../video-processing/chapter-manifest.ts'
import {
  VideoChapterAudioProbeError,
  VideoMediaPermanentError,
  VideoMediaProcessError,
  type VideoProbeMetadata
} from './types.ts'

const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  channels?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  nb_read_packets?: string
}

interface ProbeOutput {
  streams?: ProbeStream[]
  format?: { duration?: string }
}

export async function probeVideoMetadata(input: {
  sourcePath: string
  ffprobePath?: string
  ffmpegPath?: string
  timeoutMs: number
  signal: AbortSignal
}): Promise<VideoProbeMetadata> {
  const output = await runMediaProcess(
    input.ffprobePath ?? 'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-count_packets', '-show_streams', input.sourcePath],
    { timeoutMs: input.timeoutMs, signal: input.signal }
  )
  let parsed: ProbeOutput
  try {
    parsed = JSON.parse(output.stdout) as ProbeOutput
  } catch {
    throw new VideoMediaPermanentError('PRECONDITION_FAILED', 'FFprobe returned invalid JSON')
  }
  const streams = parsed.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  if (!video) throw new VideoMediaPermanentError('NOT_A_VIDEO', 'FFprobe did not find a video stream')
  const audio = streams.find(isReadableAudioStream)
  const duration = parseNumber(parsed.format?.duration) ?? parseNumber(video.duration)
  const companion = await readCompanionChapterManifest(input.sourcePath)
  let hasAudio = false
  let chapterAudio: VideoProbeMetadata['chapterAudio']

  if (companion) {
    const chapters = []
    const plans = buildChapterAudioSamplePlans(companion.audio.chapters)
    try {
      for (const plan of plans) {
        const hasAudibleAudio = audio
          ? await detectAudibleAudioWindows({
              sourcePath: input.sourcePath,
              windows: plan.windows,
              timeoutMs: input.timeoutMs,
              signal: input.signal,
              ...(input.ffmpegPath ? { ffmpegPath: input.ffmpegPath } : {})
            })
          : false
        chapters.push({
          chapterOrder: plan.chapterOrder,
          chapterIndex: plan.index,
          chapterStart: plan.start,
          hasAudibleAudio
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown chapter audio probe failure'
      throw new VideoChapterAudioProbeError(
        message,
        {
          chaptersHash: companion.chaptersHash,
          chapters: plans.map((plan) => ({
            chapterOrder: plan.chapterOrder,
            chapterIndex: plan.index,
            chapterStart: plan.start
          }))
        },
        error
      )
    }
    hasAudio = chapters.some((chapter) => chapter.hasAudibleAudio)
    chapterAudio = { chaptersHash: companion.chaptersHash, chapters }
  } else if (audio) {
    hasAudio = await detectAudibleAudioWindows({
      sourcePath: input.sourcePath,
      windows: buildUnchapteredAudioSampleWindows(duration),
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      ...(input.ffmpegPath ? { ffmpegPath: input.ffmpegPath } : {})
    })
  }

  return {
    hasAudio,
    audioCodec: hasAudio ? (audio?.codec_name ?? null) : null,
    audioChannels: hasAudio && typeof audio?.channels === 'number' ? audio.channels : null,
    videoCodec: video.codec_name ?? null,
    duration,
    fps: parseFps(video.avg_frame_rate) ?? parseFps(video.r_frame_rate),
    ...(chapterAudio ? { chapterAudio } : {})
  }
}

export async function generateVideoPoster(input: {
  sourcePath: string
  temporaryPath: string
  ffmpegPath?: string
  timeoutMs: number
  signal: AbortSignal
}) {
  await fs.mkdir(path.dirname(input.temporaryPath), { recursive: true })
  await fs.rm(input.temporaryPath, { force: true }).catch(() => undefined)
  await runMediaProcess(
    input.ffmpegPath ?? 'ffmpeg',
    [
      '-nostdin',
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '1',
      '-i',
      input.sourcePath,
      '-frames:v',
      '1',
      '-vf',
      "scale='min(960,iw)':-2",
      '-c:v',
      'libwebp',
      '-q:v',
      '80',
      input.temporaryPath
    ],
    { timeoutMs: input.timeoutMs, signal: input.signal }
  )
  const metadata = await sharp(input.temporaryPath).metadata()
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
    throw new VideoMediaPermanentError('PRECONDITION_FAILED', 'FFmpeg produced an invalid poster')
  }
}

export function runMediaProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; signal: AbortSignal }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    throwIfAborted(options.signal)
    const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    let terminationError: Error | null = null
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString()}`.slice(-MAX_PROCESS_OUTPUT_BYTES)
    child.stdout.on('data', (chunk: Buffer) => (stdout = append(stdout, chunk)))
    child.stderr.on('data', (chunk: Buffer) => (stderr = append(stderr, chunk)))
    const cleanup = () => {
      clearTimeout(timeout)
      options.signal.removeEventListener('abort', abort)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve({ stdout, stderr })
    }
    const terminate = (error: Error) => {
      if (settled || terminationError) return
      terminationError = error
      if (!child.killed) child.kill('SIGKILL')
      // A successful kill only requests termination. Keep the unique execution slot until
      // close confirms the OS process is gone; container stop grace is the final hard bound.
    }
    const abort = () => terminate(abortError(options.signal))
    const timeout = setTimeout(
      () => terminate(new VideoMediaProcessError('EXTERNAL_PROCESS_TIMEOUT', `${command} timed out`)),
      options.timeoutMs
    )
    timeout.unref()
    options.signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      if (!terminationError) finish(new VideoMediaProcessError('EXTERNAL_PROCESS_FAILED', error.message))
    })
    child.on('close', (code) => {
      if (terminationError) finish(terminationError)
      else if (code === 0) finish()
      else {
        finish(
          new VideoMediaProcessError('EXTERNAL_PROCESS_FAILED', stderr.trim() || `${command} exited with code ${code}`)
        )
      }
    })
  })
}

async function detectAudibleAudioWindows(input: {
  sourcePath: string
  windows: readonly AudioSampleWindow[]
  ffmpegPath?: string
  timeoutMs: number
  signal: AbortSignal
}): Promise<boolean> {
  for (const window of input.windows) {
    const output = await runMediaProcess(
      input.ffmpegPath ?? 'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'info',
        '-ss',
        formatSeconds(window.start),
        '-t',
        formatSeconds(window.duration),
        '-i',
        input.sourcePath,
        '-vn',
        '-map',
        '0:a:0',
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-'
      ],
      { timeoutMs: input.timeoutMs, signal: input.signal }
    )
    const volume = parseVolumedetectMaxVolume(output.stderr)
    if (volume === null) {
      throw new VideoMediaProcessError('EXTERNAL_PROCESS_FAILED', 'FFmpeg did not report a valid audio volume')
    }
    if (isAudibleMaxVolume(volume)) return true
  }
  return false
}

async function readCompanionChapterManifest(sourcePath: string) {
  const parsedPath = path.parse(sourcePath)
  try {
    const raw = await fs.readFile(path.join(parsedPath.dir, `${parsedPath.name}.chapters.json`), 'utf8')
    const value = JSON.parse(raw) as unknown
    const audio = parseCompanionAudioManifest(value, parsedPath.base)
    if (!audio) return null
    const manifest = parseChapterManifest(value)
    return { audio, chaptersHash: createChapterManifestHash(manifest) }
  } catch {
    return null
  }
}

function isReadableAudioStream(stream: ProbeStream) {
  if (stream.codec_type !== 'audio') return false
  const packets = parseNumber(stream.nb_read_packets)
  return packets === null || packets > 0
}

function parseNumber(value?: string): number | null {
  const parsed = value ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function parseFps(value?: string): number | null {
  if (!value || value === '0/0') return null
  const [numeratorRaw, denominatorRaw] = value.split('/')
  const numerator = Number(numeratorRaw)
  const denominator = denominatorRaw === undefined ? 1 : Number(denominatorRaw)
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null
}

function formatSeconds(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError(signal)
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error('Video media process was interrupted')
}

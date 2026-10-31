import { z } from 'zod'
import type { VideoProcessRunner } from '../video-processing/types.ts'

const streamSchema = z.object({
  index: z.number().int(),
  codec_type: z.string(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  sample_aspect_ratio: z.string().optional(),
  color_transfer: z.string().optional(),
  pix_fmt: z.string().optional(),
  disposition: z.object({ default: z.number().optional(), attached_pic: z.number().optional() }).optional(),
  side_data_list: z
    .array(z.object({ side_data_type: z.string().optional(), rotation: z.number().optional() }).passthrough())
    .optional()
})
const probeSchema = z.object({
  streams: z.array(streamSchema),
  format: z.object({ duration: z.coerce.number().finite().positive() })
})
export type PlaybackProbe = z.infer<typeof probeSchema>

export async function probePlaybackFile(input: {
  file: string
  runner: VideoProcessRunner
  ffprobe: string
  signal: AbortSignal
}) {
  const result = await input.runner({
    command: input.ffprobe,
    args: ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input.file],
    timeoutMs: 60_000,
    signal: input.signal
  })
  return probeSchema.parse(JSON.parse(result.stdout))
}

export function playbackEncoding(probe: PlaybackProbe, sourcePath: string, targetPath: string) {
  const videos = probe.streams.filter((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const video = videos.find((s) => s.disposition?.default) ?? videos[0]
  if (!video?.width || !video.height) throw new Error('视频没有可转码的主画面')
  if (
    ['smpte2084', 'arib-std-b67'].includes(video.color_transfer ?? '') ||
    video.side_data_list?.some((s) => /dovi|dolby vision/i.test(s.side_data_type ?? ''))
  )
    throw new Error('暂不支持 HDR 视频的播放副本，请播放原片')
  const audios = probe.streams.filter((s) => s.codec_type === 'audio')
  const audio = audios.find((s) => s.disposition?.default) ?? audios[0]
  const [sarN, sarD] = (video.sample_aspect_ratio ?? '1:1').split(':').map(Number)
  const sar = sarN && sarD ? sarN / sarD : 1
  let displayWidth = video.width * sar,
    displayHeight = video.height
  const rotation = video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0
  if (Math.abs(rotation) % 180 === 90) [displayWidth, displayHeight] = [displayHeight, displayWidth]
  const portrait = displayHeight > displayWidth
  const scale = Math.min(1, (portrait ? 1080 : 1920) / displayWidth, (portrait ? 1920 : 1080) / displayHeight)
  const width = Math.max(2, Math.floor((displayWidth * scale) / 2) * 2)
  const height = Math.max(2, Math.floor((displayHeight * scale) / 2) * 2)
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    sourcePath,
    '-map',
    `0:${video.index}`,
    ...(audio ? ['-map', `0:${audio.index}`, '-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-threads',
    '2',
    '-b:v',
    '4M',
    '-maxrate',
    '4M',
    '-bufsize',
    '8M',
    '-vf',
    `scale=${width}:${height},setsar=1`,
    '-pix_fmt',
    'yuv420p',
    '-fps_mode',
    'passthrough',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '0',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    targetPath
  ]
  return { args, width, height, hasAudio: !!audio }
}

export function validatePlaybackOutput(
  probe: PlaybackProbe,
  expected: { width: number; height: number; hasAudio: boolean; duration: number }
) {
  const video = probe.streams.find((s) => s.codec_type === 'video')
  const audio = probe.streams.find((s) => s.codec_type === 'audio')
  if (
    video?.codec_name !== 'h264' ||
    video.pix_fmt !== 'yuv420p' ||
    video.width !== expected.width ||
    video.height !== expected.height ||
    Boolean(audio) !== expected.hasAudio ||
    (audio && audio.codec_name !== 'aac') ||
    Math.abs(probe.format.duration - expected.duration) > Math.max(0.25, expected.duration * 0.001)
  )
    throw new Error('播放副本校验失败：编码、画面或时长与预期不符')
}

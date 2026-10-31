import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runVideoProcess } from '../../video-processing/process-runner.ts'
import { playbackEncoding, probePlaybackFile, validatePlaybackOutput } from '../media-process.ts'
const available = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0

describe.skipIf(!available)('real FFmpeg playback copies', () => {
  it('rejects a real PQ-tagged HDR video before encoding', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'playback-hdr-'))
    const file = path.join(root, 'hdr.mp4'),
      signal = new AbortController().signal
    try {
      await runVideoProcess({
        command: 'ffmpeg',
        args: [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=320x180:rate=30',
          '-t',
          '0.5',
          '-c:v',
          'libx264',
          '-threads',
          '2',
          '-vf',
          'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
          '-x264-params',
          'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc',
          file
        ],
        signal,
        timeoutMs: 30_000
      })
      const probe = await probePlaybackFile({ file, runner: runVideoProcess, ffprobe: 'ffprobe', signal })
      expect(() => playbackEncoding(probe, file, path.join(root, 'copy.mp4'))).toThrow('暂不支持 HDR')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    { size: '2560x1440', rate: 24, audio: true },
    { size: '1080x1920', rate: 30, audio: false },
    { size: '320x180', rate: 60, audio: false }
  ])(
    'transcodes $size $rate fps audio=$audio',
    async ({ size, rate, audio }) => {
      const root = await mkdtemp(path.join(tmpdir(), 'playback-encode-'))
      const original = path.join(root, 'source.mkv'),
        output = path.join(root, 'copy.mp4')
      const signal = new AbortController().signal
      try {
        await runVideoProcess({
          command: 'ffmpeg',
          args: [
            '-v',
            'error',
            '-f',
            'lavfi',
            '-i',
            `testsrc2=size=${size}:rate=${rate}`,
            ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'] : []),
            '-t',
            '1.2',
            '-c:v',
            'ffv1',
            '-threads',
            '2',
            ...(audio ? ['-c:a', 'pcm_s16le'] : []),
            original
          ],
          timeoutMs: 60_000,
          signal
        })
        const hash = createHash('sha256')
          .update(await readFile(original))
          .digest('hex')
        const input = await probePlaybackFile({ file: original, runner: runVideoProcess, ffprobe: 'ffprobe', signal })
        const encoding = playbackEncoding(input, original, output)
        await runVideoProcess({ command: 'ffmpeg', args: encoding.args, timeoutMs: 60_000, signal })
        const result = await probePlaybackFile({ file: output, runner: runVideoProcess, ffprobe: 'ffprobe', signal })
        validatePlaybackOutput(result, { ...encoding, duration: input.format.duration })
        expect(
          createHash('sha256')
            .update(await readFile(original))
            .digest('hex')
        ).toBe(hash)
        expect((await stat(output)).size).toBeLessThan((await stat(original)).size)
        const bytes = await readFile(output)
        expect(bytes.indexOf(Buffer.from('moov'))).toBeLessThan(bytes.indexOf(Buffer.from('mdat')))
        const frames = await runVideoProcess({
          command: 'ffprobe',
          args: [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-count_frames',
            '-show_entries',
            'stream=avg_frame_rate,nb_read_frames',
            '-of',
            'json',
            output
          ],
          timeoutMs: 30_000,
          signal
        })
        const stream = JSON.parse(frames.stdout).streams[0]
        const [n, d] = stream.avg_frame_rate.split('/').map(Number)
        expect(n / d).toBeCloseTo(rate, 1)
        expect(Number(stream.nb_read_frames)).toBeGreaterThanOrEqual(rate)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    90_000
  )
})

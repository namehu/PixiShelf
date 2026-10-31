import { describe, expect, it } from 'vitest'
import { playbackEncoding, validatePlaybackOutput, type PlaybackProbe } from '../media-process.ts'
const probe = (width = 3840, height = 2160): PlaybackProbe => ({
  streams: [{ index: 0, codec_type: 'video', width, height }],
  format: { duration: 5 }
})

describe('playback encoding profile', () => {
  it.each([
    [3840, 2160, 1920, 1080],
    [2160, 3840, 1080, 1920],
    [640, 360, 640, 360],
    [641, 361, 640, 360]
  ])('scales %sx%s without enlargement', (w, h, ow, oh) => {
    const result = playbackEncoding(probe(w, h), 'source.mkv', 'copy.mp4')
    expect([result.width, result.height]).toEqual([ow, oh])
    expect(result.args).toContain('4M')
    expect(result.args).toContain('8M')
    expect(result.args).toContain('passthrough')
    expect(result.args).not.toContain('-r')
  })
  it('honors rotated display dimensions and anamorphic aspect ratio', () => {
    const input = probe(1920, 1080)
    input.streams[0]!.side_data_list = [{ rotation: -90 }]
    expect(playbackEncoding(input, 'a', 'b')).toMatchObject({ width: 1080, height: 1920 })
    input.streams[0]!.side_data_list = []
    input.streams[0]!.sample_aspect_ratio = '2:1'
    expect(playbackEncoding(input, 'a', 'b')).toMatchObject({ width: 1920, height: 540 })
  })
  it.each(['smpte2084', 'arib-std-b67'])('rejects HDR %s', (transfer) => {
    const input = probe()
    input.streams[0]!.color_transfer = transfer
    expect(() => playbackEncoding(input, 'a', 'b')).toThrow('HDR')
  })
  it('selects the default audio track and ignores cover art', () => {
    const input = probe()
    input.streams.unshift({ index: 9, codec_type: 'video', disposition: { attached_pic: 1 }, width: 100, height: 100 })
    input.streams.push(
      { index: 1, codec_type: 'audio' },
      { index: 2, codec_type: 'audio', disposition: { default: 1 } }
    )
    const encoded = playbackEncoding(input, 'a', 'b')
    expect(encoded.args).toContain('0:0')
    expect(encoded.args).toContain('0:2')
    expect(encoded.args).not.toContain('0:1')
    expect(encoded.args).toContain('128k')
  })
  it('does not manufacture audio and rejects incomplete outputs', () => {
    expect(playbackEncoding(probe(), 'a', 'b').args).toContain('-an')
    expect(() => validatePlaybackOutput(probe(), { width: 1920, height: 1080, hasAudio: false, duration: 5 })).toThrow(
      '校验失败'
    )
  })
})

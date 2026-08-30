import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

import { probeVideoMetadata } from '../media-process.js'

const roots: string[] = []

beforeEach(() => spawn.mockReset())
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

describe('video media audible audio probing', () => {
  it('does not trust a v2 hasAudio=true sidecar when every chapter is silent', async () => {
    const sourcePath = await fixtureVideo({
      version: 2,
      hasAudio: true,
      chapters: [
        { index: 1, title: 'one', start: 0, end: 5, duration: 5 },
        { index: 2, title: 'two', start: 5, end: 10, duration: 5 }
      ]
    })
    spawn
      .mockImplementationOnce(() => completedProcess(ffprobeOutput(true)))
      .mockImplementationOnce(() => completedProcess('', 'max_volume: -91.0 dB'))
      .mockImplementationOnce(() => completedProcess('', 'max_volume: -inf dB'))

    await expect(probe(sourcePath)).resolves.toMatchObject({
      hasAudio: false,
      audioCodec: null,
      chapterAudio: {
        chapters: [{ hasAudibleAudio: false }, { hasAudibleAudio: false }]
      }
    })
  })

  it('finds audio in a middle chapter that fixed whole-video windows could miss', async () => {
    const sourcePath = await fixtureVideo({
      version: 3,
      duration: 40,
      hasAudio: true,
      chapters: [
        { index: 1, title: 'one', start: 0, end: 10, duration: 10 },
        { index: 2, title: 'two', start: 10, end: 15, duration: 5 },
        { index: 3, title: 'three', start: 15, end: 30, duration: 15 },
        { index: 4, title: 'four', start: 30, end: 40, duration: 10 }
      ]
    })
    spawn
      .mockImplementationOnce(() => completedProcess(ffprobeOutput(true, 40)))
      .mockImplementationOnce(() => completedProcess('', 'max_volume: -91.0 dB'))
      .mockImplementationOnce(() => completedProcess('', 'max_volume: -20.0 dB'))
      .mockImplementationOnce(() => completedProcess('', 'max_volume: -91.0 dB'))
      .mockImplementationOnce(() => completedProcess('', 'max_volume: -91.0 dB'))

    const result = await probe(sourcePath)
    expect(result.hasAudio).toBe(true)
    expect(result.chapterAudio?.chapters.map((chapter) => chapter.hasAudibleAudio)).toEqual([false, true, false, false])
  })

  it('fails the probe instead of falling back to stream presence when volume detection fails', async () => {
    const sourcePath = await fixtureVideo(null)
    spawn
      .mockImplementationOnce(() => completedProcess(ffprobeOutput(true)))
      .mockImplementationOnce(() => completedProcess('', 'decoder failed', 1))

    await expect(probe(sourcePath)).rejects.toThrow('decoder failed')
  })

  it('marks streams without packets as having no audible audio without invoking FFmpeg', async () => {
    const sourcePath = await fixtureVideo(null)
    spawn.mockImplementationOnce(() => completedProcess(ffprobeOutput(true, 10, '0')))

    await expect(probe(sourcePath)).resolves.toMatchObject({ hasAudio: false, audioCodec: null })
    expect(spawn).toHaveBeenCalledOnce()
  })
})

async function fixtureVideo(manifest: Record<string, unknown> | null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-audio-probe-'))
  roots.push(root)
  const sourcePath = path.join(root, 'output.mp4')
  await fs.writeFile(sourcePath, 'fixture')
  if (manifest) {
    await fs.writeFile(
      path.join(root, 'output.chapters.json'),
      JSON.stringify({ video: 'output.mp4', duration: 10, ...manifest })
    )
  }
  return sourcePath
}

function probe(sourcePath: string) {
  return probeVideoMetadata({
    sourcePath,
    timeoutMs: 10_000,
    signal: new AbortController().signal
  })
}

function ffprobeOutput(hasAudio: boolean, duration = 10, packetCount = '100') {
  return JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
      ...(hasAudio ? [{ codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: packetCount }] : [])
    ],
    format: { duration: String(duration) }
  })
}

function completedProcess(stdout: string, stderr = '', code = 0) {
  const child = fakeChild()
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    child.emit('close', code)
  })
  return child
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    killed: boolean
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })
  return child
}

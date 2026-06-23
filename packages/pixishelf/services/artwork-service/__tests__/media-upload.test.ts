import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMediaUploadStatus, handleMediaUploadChunk } from '../media-upload'

// 这些用例覆盖 media-upload 服务的关键可靠性边界：
// 1. 用真实临时目录读写文件，验证上传结果确实落盘，而不只是在内存里返回成功。
// 2. mock sharp，只隔离图片尺寸读取这一外部依赖，保留文件系统和分片写入的真实行为。
// 3. 同时验证成功路径、续传冲突、非法输入和状态查询，避免 API route 复用服务时破坏既有契约。
const { sharpMetadataMock, sharpMock } = vi.hoisted(() => {
  const sharpMetadataMock = vi.fn()
  const sharpMock = vi.fn(() => ({ metadata: sharpMetadataMock }))

  return { sharpMetadataMock, sharpMock }
})

vi.mock('sharp', () => ({
  default: sharpMock
}))

describe('media-upload service', () => {
  let scanRoot: string

  beforeEach(async () => {
    // 每个测试使用独立临时目录，避免上传文件互相污染，也让断言可以检查真实文件内容。
    scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-media-upload-'))
    sharpMock.mockClear()
    sharpMetadataMock.mockReset()
  })

  afterEach(async () => {
    // 清理临时目录，让测试可以重复运行，并避免本地环境残留影响后续用例。
    await rm(scanRoot, { recursive: true, force: true })
  })

  it('writes final image chunk and returns existing ImageMeta shape', async () => {
    // 单分片图片上传走完整 final 路径：写文件、读取图片尺寸、生成 ImageMeta。
    // 这里锁定返回字段和磁盘内容，防止后续重构只返回成功但没有正确落盘或破坏前端依赖的数据形状。
    sharpMetadataMock.mockResolvedValueOnce({ width: 640, height: 480 })

    const result = await handleMediaUploadChunk({
      scanRoot,
      fileName: '003-cover.jpg',
      targetDir: 'Artist/Work',
      targetRelDir: '/Artist/Work',
      chunkIndex: 0,
      totalChunks: 1,
      offset: 0,
      declaredFileSize: 5,
      body: Readable.from(Buffer.from('image'))
    })

    expect(result).toEqual({
      type: 'final',
      meta: [
        {
          fileName: '003-cover.jpg',
          order: 3,
          width: 640,
          height: 480,
          size: 5,
          path: '/Artist/Work/003-cover.jpg'
        }
      ]
    })
    await expect(readFile(path.join(scanRoot, 'Artist/Work/003-cover.jpg'), 'utf8')).resolves.toBe('image')
    expect(sharpMock).toHaveBeenCalledTimes(1)
  })

  it('writes final video chunk without probing image dimensions', async () => {
    // 视频文件也应被写入并返回 meta，但不能调用 sharp；否则视频上传会误走图片解析路径。
    // 断言 width/height 为 0，保护了“视频不探测图片尺寸”的服务契约。
    const result = await handleMediaUploadChunk({
      scanRoot,
      fileName: 'movie.mp4',
      targetDir: 'Artist/Work',
      targetRelDir: '/Artist/Work',
      chunkIndex: 0,
      totalChunks: 1,
      offset: 0,
      declaredFileSize: 5,
      body: Readable.from(Buffer.from('video'))
    })

    expect(result).toEqual({
      type: 'final',
      meta: [
        {
          fileName: 'movie.mp4',
          order: 0,
          width: 0,
          height: 0,
          size: 5,
          path: '/Artist/Work/movie.mp4'
        }
      ]
    })
    expect(sharpMock).not.toHaveBeenCalled()
  })

  it('rejects resume chunks when the file does not exist', async () => {
    // 非首分片必须基于已经存在的部分文件续写；如果目标文件不存在，说明客户端续传状态不可靠。
    // 返回 409 可以让调用方重新开始上传，而不是悄悄在 offset 处创建损坏文件。
    await expect(
      handleMediaUploadChunk({
        scanRoot,
        fileName: 'resume.jpg',
        targetDir: 'Artist/Work',
        targetRelDir: '/Artist/Work',
        chunkIndex: 1,
        totalChunks: 2,
        offset: 5,
        declaredFileSize: 10,
        body: Readable.from(Buffer.from('chunk'))
      })
    ).rejects.toMatchObject({ status: 409, message: 'File not found for resume' })
  })

  it('rejects unsafe file names with the existing message', async () => {
    // 文件名校验阻止 ../ 这类路径逃逸；同时固定原有错误消息，避免 API 行为被无意改坏。
    await expect(
      handleMediaUploadChunk({
        scanRoot,
        fileName: '../escape.jpg',
        targetDir: 'Artist/Work',
        targetRelDir: '/Artist/Work',
        chunkIndex: 0,
        totalChunks: 1,
        offset: 0,
        declaredFileSize: 10,
        body: Readable.from(Buffer.from('chunk'))
      })
    ).rejects.toMatchObject({ status: 400, message: 'Invalid file name' })
  })

  it('rejects unsupported media extensions with the existing message', async () => {
    // 扩展名白名单能避免把非媒体文件写进图库目录；错误消息断言保护调用方现有错误处理。
    await expect(
      handleMediaUploadChunk({
        scanRoot,
        fileName: 'notes.txt',
        targetDir: 'Artist/Work',
        targetRelDir: '/Artist/Work',
        chunkIndex: 0,
        totalChunks: 1,
        offset: 0,
        declaredFileSize: 10,
        body: Readable.from(Buffer.from('chunk'))
      })
    ).rejects.toMatchObject({ status: 400, message: 'Unsupported file extension' })
  })

  it('returns existing upload status for partial files', async () => {
    // 状态查询用于断点续传：服务需要准确报告部分文件是否存在以及已有字节数。
    // 这里先手动制造一个部分文件，再验证 getMediaUploadStatus 读取到真实文件大小。
    await mkdir(path.join(scanRoot, 'Artist/Work'), { recursive: true })
    await writeFile(path.join(scanRoot, 'Artist/Work/partial.png'), '1234')

    await expect(
      getMediaUploadStatus({ scanRoot, fileName: 'partial.png', targetDir: 'Artist/Work' })
    ).resolves.toEqual({
      exists: true,
      size: 4
    })
  })
})

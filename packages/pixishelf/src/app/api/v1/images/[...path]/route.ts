import { NextRequest, NextResponse } from 'next/server'
import { promises as fs, createReadStream } from 'fs'
import * as path from 'path'
import logger from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import { getMediaMimeType } from '@/utils/media'

/**
 * 图片/媒体文件服务接口
 * GET /api/v1/images/[...path]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  try {
    const { path: pathSegments } = await params

    // 1. 基础校验
    if (!pathSegments || pathSegments.length === 0) {
      return NextResponse.json({ error: 'File path is required' }, { status: 400 })
    }

    const scanPath = await getScanPath()
    if (!scanPath) {
      return NextResponse.json({ error: 'Scan path not configured' }, { status: 500 })
    }

    // 2. 路径构建与安全清洗
    // 将 URL 编码的部分解码，并重新组合
    const decodedSegments = pathSegments.map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        return p
      }
    })

    const relativePath = path.join(...decodedSegments)
    // 核心安全：确保解析后的绝对路径一定在 scanPath 目录下
    const resolvedScanPath = path.resolve(scanPath)
    const fullFilePath = path.resolve(resolvedScanPath, relativePath)

    if (!fullFilePath.startsWith(resolvedScanPath)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // 3. 检查文件状态 (使用 stat 而不是 readFile)
    let stats
    try {
      stats = await fs.stat(fullFilePath)
      if (!stats.isFile()) {
        return NextResponse.json({ error: 'Not a file' }, { status: 404 })
      }
    } catch (e) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // 4. 准备 Headers 和 ETag
    const contentType = getMediaMimeType(fullFilePath) || 'application/octet-stream'
    // 生成简单的 ETag (基于大小和修改时间)
    const etag = `"${stats.size}-${stats.mtimeMs}"`

    // 检查 ETag 缓存 (304 Not Modified)
    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304 })
    }

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('ETag', etag)
    headers.set('Accept-Ranges', 'bytes') // 告诉浏览器我支持断点续传

    // 5. 处理 Range 请求 (关键优化)
    const fileSize = stats.size
    const range = request.headers.get('range')

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0] || '0', 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1

      // 校验 Range 有效性
      if (start >= fileSize || end >= fileSize) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` }
        })
      }

      const chunksize = end - start + 1

      // 核心优化：只读取需要的这一段文件流
      const fileStream = createReadStream(fullFilePath, { start, end })

      headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`)
      headers.set('Content-Length', chunksize.toString())

      // @ts-expect-error NextResponse 支持 Node Stream，但类型定义可能未跟上
      return new NextResponse(fileStream, {
        status: 206,
        headers
      })
    }

    // 6. 普通请求：流式返回完整文件
    headers.set('Content-Length', fileSize.toString())
    const fileStream = createReadStream(fullFilePath)

    // @ts-expect-error NextResponse 支持 Node Stream
    return new NextResponse(fileStream, {
      status: 200,
      headers
    })
  } catch (error) {
    logger.error('Failed to serve media file:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

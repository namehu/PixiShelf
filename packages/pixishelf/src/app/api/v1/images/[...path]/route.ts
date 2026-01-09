import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
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
    const filePath = pathSegments.join('/')
    if (!filePath) {
      return NextResponse.json({ error: 'File path is required' }, { status: 400 })
    }

    // 解码文件路径
    let decodedPath = filePath
    try {
      decodedPath = decodeURIComponent(filePath)
    } catch {
      // 如果解码失败，使用原始路径
    }

    // 获取扫描路径设置
    const scanPath = await getScanPath()
    if (!scanPath) {
      return NextResponse.json({ error: 'Scan path not configured' }, { status: 500 })
    }

    // 规范化路径：将反斜杠替换为正斜杠，并过滤空值
    const platformPath = decodedPath.replace(/\\/g, '/').split('/').filter(Boolean).join('/')

    // 构建完整文件路径
    let fullPath = '/' + platformPath
    if (!fullPath.startsWith(scanPath)) {
      fullPath = path.resolve(scanPath, platformPath)
    }

    // 安全检查：确保文件路径在扫描目录内
    const resolvedScanPath = path.resolve(scanPath)
    const resolvedFilePath = path.resolve(fullPath)

    if (!resolvedFilePath.startsWith(resolvedScanPath)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // 检查文件是否存在
    try {
      const stats = await fs.stat(resolvedFilePath)
      if (!stats.isFile()) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }
    } catch (error) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // 读取文件
    const fileBuffer = await fs.readFile(resolvedFilePath)

    // 获取文件扩展名并设置MIME类型
    const contentType = getMediaMimeType(resolvedFilePath) || 'application/octet-stream'

    // 设置缓存头
    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable') // 1年缓存
    headers.set('Content-Length', fileBuffer.length.toString())

    // 支持范围请求（用于视频流）
    const range = request.headers.get('range')
    if (range && contentType.startsWith('video/')) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0] || '0', 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileBuffer.length - 1
      const chunksize = end - start + 1
      const chunk = fileBuffer.slice(start, end + 1)

      headers.set('Content-Range', `bytes ${start}-${end}/${fileBuffer.length}`)
      headers.set('Accept-Ranges', 'bytes')
      headers.set('Content-Length', chunksize.toString())

      return new NextResponse(new Uint8Array(chunk), {
        status: 206,
        headers
      })
    }

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers
    })
  } catch (error) {
    logger.error('Failed to serve media file:', error)
    return NextResponse.json({ error: 'Failed to serve media file' }, { status: 500 })
  }
}

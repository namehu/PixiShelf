import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { isPixivDataRoot } from '@/lib/pixiv-data'
import { resolveExistingPathWithinRoot, UnsafePathError } from '@/lib/safe-path'
import logger from '@/lib/logger'
import { PIXIV_DATA_STORAGE_ROOT } from '@/services/pixiv-data-storage-paths'
import { getMediaMimeType } from '@/utils/media'

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'])

// 只暴露 Pixiv 数据目录下的两类图片；真实文件仍经 safe-path 校验以阻断越界和符号链接逃逸。

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return servePixivData(request, context, false)
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return servePixivData(request, context, true)
}

async function servePixivData(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
  headOnly: boolean
): Promise<NextResponse> {
  try {
    const { path: rawSegments } = await params
    const segments = rawSegments?.map(decodeSegment) ?? []
    if (
      segments.length < 2 ||
      !isPixivDataRoot(segments[0] ?? '') ||
      segments.some((segment) => !segment || segment === '.' || segment === '..' || /[/\\]/.test(segment))
    ) {
      return NextResponse.json({ error: 'Invalid Pixiv data path' }, { status: 400 })
    }
    const relativePath = path.join(...segments)
    if (!ALLOWED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
      return NextResponse.json({ error: 'Unsupported Pixiv data file type' }, { status: 415 })
    }

    let filePath: string
    try {
      filePath = await resolveExistingPathWithinRoot(PIXIV_DATA_STORAGE_ROOT, relativePath)
    } catch (error) {
      if (error instanceof UnsafePathError) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }
      throw error
    }

    const stats = await fs.stat(filePath)
    if (!stats.isFile()) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    const etag = `"${stats.size}-${stats.mtimeMs}"`
    if (request.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304 })

    const headers = new Headers({
      'Content-Type': getMediaMimeType(filePath) || 'application/octet-stream',
      'Content-Length': String(stats.size),
      // 标签文件按内容哈希命名，成功写入后不可变；作者资源保留较短缓存以兼容旧文件更新。
      'Cache-Control': segments[0] === 'tags' ? 'private, max-age=31536000, immutable' : 'private, max-age=3600',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff'
    })
    if (headOnly) return new NextResponse(null, { status: 200, headers })

    const stream = createReadStream(filePath)
    // @ts-expect-error NextResponse accepts a Node stream at runtime.
    return new NextResponse(stream, { status: 200, headers })
  } catch (error) {
    logger.error('Failed to serve Pixiv data file:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

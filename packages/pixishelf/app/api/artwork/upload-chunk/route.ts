import { NextRequest } from 'next/server'
import { Readable } from 'stream'
import { apiError, apiJson, apiSuccess } from '@/lib/api-response'
import { getScanPath } from '@/services/setting.service'
import {
  getMediaUploadStatus,
  handleMediaUploadChunk,
  MediaUploadError,
  validateMediaUploadChunkMetadata,
  validateMediaUploadStatusMetadata
} from '@/services/artwork-service/media-upload'

export async function POST(req: NextRequest) {
  try {
    const fileName = req.headers.get('x-file-name')
    const targetDir = req.headers.get('x-target-dir')
    const targetRelDir = req.headers.get('x-target-rel-dir')
    const chunkIndexStr = req.headers.get('x-chunk-index')
    const totalChunksStr = req.headers.get('x-total-chunks')
    const offsetStr = req.headers.get('x-offset')
    const fileSizeStr = req.headers.get('x-file-size')

    if (!fileName || !targetDir) {
      return apiError('Missing required headers', { status: 400 })
    }

    const chunkIndex = parseInt(chunkIndexStr || '0')
    const totalChunks = parseInt(totalChunksStr || '1')
    const offset = parseInt(offsetStr || '0')
    const declaredFileSize = fileSizeStr ? Number(fileSizeStr) : null

    // Decode headers
    const decodedFileName = decodeURIComponent(fileName)
    const decodedTargetDir = decodeURIComponent(targetDir)
    const decodedTargetRelDir = targetRelDir ? decodeURIComponent(targetRelDir) : ''

    validateMediaUploadChunkMetadata({
      fileName: decodedFileName,
      declaredFileSize
    })

    // 1. 安全校验：防止路径遍历
    const scanRoot = await getScanPath()
    if (!scanRoot) {
      return apiError('Server configuration error: SCAN_ROOT not set')
    }

    // Convert Web Stream to Node Stream
    // @ts-ignore: Readable.fromWeb is available in Node 18+ which Next.js 16 uses
    const nodeStream = req.body ? Readable.fromWeb(req.body) : null

    const result = await handleMediaUploadChunk({
      scanRoot,
      fileName: decodedFileName,
      targetDir: decodedTargetDir,
      targetRelDir: decodedTargetRelDir,
      chunkIndex,
      totalChunks,
      offset,
      declaredFileSize,
      body: nodeStream
    })

    if (result.type === 'final') {
      return apiSuccess({ meta: result.meta })
    }

    return apiSuccess()
  } catch (error: any) {
    if (error instanceof MediaUploadError) {
      return apiError(error.message, { status: error.status })
    }

    console.error('Upload chunk error:', error)
    return apiError(error.message)
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const fileName = url.searchParams.get('fileName')
    const targetDir = url.searchParams.get('targetDir')

    if (!fileName || !targetDir) {
      return apiError('Missing params', { status: 400 })
    }

    const decodedFileName = decodeURIComponent(fileName)
    const decodedTargetDir = decodeURIComponent(targetDir)

    validateMediaUploadStatusMetadata(decodedFileName)

    // Security check
    const scanRoot = await getScanPath()
    if (!scanRoot) return apiError('Config error')

    const status = await getMediaUploadStatus({
      scanRoot,
      fileName: decodedFileName,
      targetDir: decodedTargetDir
    })

    return apiJson(status)
  } catch (e: any) {
    if (e instanceof MediaUploadError) {
      return apiError(e.message, { status: e.status })
    }

    return apiError(e.message)
  }
}

import { z } from 'zod'
import { ContentWriteAuthorizationSchema } from '@/schemas/media-content.dto'
import logger from '@/lib/logger'
import { NextRequest } from 'next/server'
import { Readable } from 'stream'
import { apiError, apiJson, apiSuccess } from '@/lib/api-response'
import { ApiError } from '@/lib/api-handler'
import { getScanPath } from '@/services/setting.service'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import {
  getMediaUploadStatus,
  restartMediaUpload,
  handleMediaUploadChunk,
  MediaUploadError,
  validateMediaUploadChunkMetadata,
  validateMediaUploadStatusMetadata
} from '@/services/artwork-service/media-upload'

export async function POST(req: NextRequest) {
  let userId: string
  try {
    userId = (await requireAdminRequest(req)).userId
  } catch (error) {
    if (error instanceof ApiError) return apiError(error.message, { status: error.statusCode })
    throw error
  }

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

    // 解码请求头中的文件名与目录参数（处理 URL 编码）
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

    // 将 Web Stream 转为 Node Stream，便于复用服务端流式写入链路
    // @ts-ignore: Readable.fromWeb 在 Node 18+ 可用；Next.js 16 运行时已依赖该能力
    const nodeStream = req.body ? Readable.fromWeb(req.body) : null

    const protocol = uploadProtocol(req)
    const result = await handleMediaUploadChunk({
      ...protocol,
      userId,
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
      return apiSuccess({ ...result, meta: result.meta })
    }

    return apiSuccess(result)
  } catch (error) {
    if (error instanceof z.ZodError) return apiError('Invalid upload session', { status: 400 })
    if (error instanceof MediaUploadError || (error instanceof Error && 'status' in error && error.status === 409)) {
      return apiError(error.message, { status: error instanceof MediaUploadError ? error.status : 409 })
    }

    logger.error('Media chunk upload failed', { error })
    return apiError('Internal Server Error')
  }
}

export async function GET(req: NextRequest) {
  let userId: string
  try {
    userId = (await requireAdminRequest(req)).userId
  } catch (error) {
    if (error instanceof ApiError) return apiError(error.message, { status: error.statusCode })
    throw error
  }

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

    // 安全检查：无效配置直接拒绝，避免出现不可写入路径
    const scanRoot = await getScanPath()
    if (!scanRoot) return apiError('Config error')

    const protocol = uploadProtocol(req, true)
    const status = await getMediaUploadStatus({
      ...protocol,
      userId,
      scanRoot,
      fileName: decodedFileName,
      targetDir: decodedTargetDir
    })

    return apiJson(status)
  } catch (e) {
    if (e instanceof z.ZodError) return apiError('Invalid upload session', { status: 400 })
    if (e instanceof MediaUploadError || (e instanceof Error && 'status' in e && e.status === 409)) {
      return apiError(e.message, { status: e instanceof MediaUploadError ? e.status : 409 })
    }

    logger.error('Media upload status failed', { error: e })
    return apiError('Internal Server Error')
  }
}

function uploadProtocol(req: NextRequest, statusOnly = false) {
  const schema = z.object({
    expectedUserId: z.string().min(1).max(200),
    sessionId: z.string().uuid(),
    writeToken: z.string().uuid(),
    requestId: z.string().uuid(),
    authorization: ContentWriteAuthorizationSchema.optional(),
    parent: ContentWriteAuthorizationSchema.optional()
  })
  const parseHeader = (name: string) => {
    const value = req.headers.get(name)
    if (!value) return undefined
    try {
      return JSON.parse(value)
    } catch {
      throw new MediaUploadError('Invalid upload session', 400)
    }
  }
  return schema.parse({
    expectedUserId: req.headers.get('x-expected-user-id'),
    sessionId: req.headers.get('x-upload-session-id'),
    writeToken: req.headers.get('x-upload-token'),
    requestId: statusOnly ? '00000000-0000-4000-8000-000000000000' : req.headers.get('x-upload-request-id'),
    authorization: parseHeader('x-upload-authorization'),
    parent: parseHeader('x-upload-parent')
  })
}

export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAdminRequest(req)
    const protocol = uploadProtocol(req, true)
    if (!protocol.authorization || protocol.parent) return apiError('Missing restart authorization', { status: 400 })
    const fileName = decodeURIComponent(req.headers.get('x-file-name') ?? '')
    const targetDir = decodeURIComponent(req.headers.get('x-target-dir') ?? '')
    validateMediaUploadStatusMetadata(fileName)
    if (!targetDir) return apiError('Missing target directory', { status: 400 })
    const scanRoot = await getScanPath()
    if (!scanRoot) return apiError('Config error')
    return apiJson(
      await restartMediaUpload({
        ...protocol,
        authorization: protocol.authorization,
        userId,
        scanRoot,
        fileName,
        targetDir
      })
    )
  } catch (error) {
    if (error instanceof ApiError) return apiError(error.message, { status: error.statusCode })
    if (error instanceof z.ZodError || error instanceof URIError) {
      return apiError('Invalid upload session', { status: 400 })
    }
    if (error instanceof MediaUploadError || (error instanceof Error && 'status' in error && error.status === 409)) {
      return apiError(error.message, { status: error instanceof MediaUploadError ? error.status : 409 })
    }
    logger.error('Media upload restart failed', { error })
    return apiError('Internal Server Error')
  }
}

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { Readable } from 'stream'
import { getScanPath } from '@/services/setting.service'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import { ImageMeta } from '@/services/artwork-service/image-manager'
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '@/lib/constant'
import { MAX_MEDIA_UPLOAD_SIZE_BYTES, MAX_MEDIA_UPLOAD_SIZE_LABEL } from '@/lib/upload-limits'
import { assertSafeFileName, resolveCreatablePathWithinRoot, UnsafePathError } from '@/lib/safe-path'

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
      return NextResponse.json({ error: 'Missing required headers' }, { status: 400 })
    }

    const chunkIndex = parseInt(chunkIndexStr || '0')
    const totalChunks = parseInt(totalChunksStr || '1')
    const offset = parseInt(offsetStr || '0')
    const declaredFileSize = fileSizeStr ? Number(fileSizeStr) : null

    // Decode headers
    const decodedFileName = decodeURIComponent(fileName)
    const decodedTargetDir = decodeURIComponent(targetDir)
    const decodedTargetRelDir = targetRelDir ? decodeURIComponent(targetRelDir) : ''

    try {
      assertSafeFileName(decodedFileName)
    } catch (error) {
      if (error instanceof UnsafePathError) {
        return NextResponse.json({ error: 'Invalid file name' }, { status: 400 })
      }
      throw error
    }

    // 0. Validate file extension
    const ext = path.extname(decodedFileName).toLowerCase()
    if (!MEDIA_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: 'Unsupported file extension' }, { status: 400 })
    }

    if (declaredFileSize !== null && declaredFileSize > MAX_MEDIA_UPLOAD_SIZE_BYTES) {
      return NextResponse.json({ error: `File size exceeds limit (${MAX_MEDIA_UPLOAD_SIZE_LABEL})` }, { status: 400 })
    }

    // 1. 安全校验：防止路径遍历
    const scanRoot = await getScanPath()
    if (!scanRoot) {
      return NextResponse.json({ error: 'Server configuration error: SCAN_ROOT not set' }, { status: 500 })
    }

    let resolvedTargetDir: string
    let filePath: string
    try {
      resolvedTargetDir = await resolveCreatablePathWithinRoot(scanRoot, decodedTargetDir)
      filePath = await resolveCreatablePathWithinRoot(scanRoot, path.join(resolvedTargetDir, decodedFileName))
    } catch (error) {
      if (error instanceof UnsafePathError) {
        return NextResponse.json({ error: 'Permission denied: Invalid target path' }, { status: 403 })
      }
      throw error
    }

    fs.mkdirSync(resolvedTargetDir, { recursive: true })

    // Ensure the body is present
    if (!req.body) {
      return NextResponse.json({ error: 'No body provided' }, { status: 400 })
    }

    // 2. 修复追加写入的 Bug：第一片使用覆盖('w')，后续使用随机写入('r+')支持断点续传
    const flags = chunkIndex === 0 ? 'w' : 'r+'
    const writeOptions: { flags: string; start?: number } = { flags }

    if (chunkIndex > 0) {
      // 确保 offset 有效
      writeOptions.start = offset

      // 如果文件不存在但尝试续传，降级为 'w' (或者报错，这里选择报错更安全)
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'File not found for resume' }, { status: 409 })
      }
    }

    // 如果是第一片，尝试删除可能存在的旧文件，避免旧数据残留
    if (chunkIndex === 0 && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch (e) {
        // 'w' 模式也会清空文件，这里忽略删除错误（如文件锁定）
        console.warn('Warning: Could not delete existing file before upload', e)
      }
    }

    // Convert Web Stream to Node Stream
    // @ts-ignore: Readable.fromWeb is available in Node 18+ which Next.js 16 uses
    const nodeStream = Readable.fromWeb(req.body)
    const writeStream = fs.createWriteStream(filePath, writeOptions)

    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(writeStream)

      nodeStream.on('error', (err: any) => {
        writeStream.close()
        reject(err)
      })

      writeStream.on('error', (err: any) => reject(err))

      writeStream.on('finish', () => resolve())
    })

    // If this is the last chunk, process the file
    if (chunkIndex === totalChunks - 1) {
      try {
        // Check size limit
        const stats = fs.statSync(filePath)
        if (stats.size > MAX_MEDIA_UPLOAD_SIZE_BYTES) {
          fs.unlinkSync(filePath)
          return NextResponse.json(
            { error: `File size exceeds limit (${MAX_MEDIA_UPLOAD_SIZE_LABEL})` },
            { status: 400 }
          )
        }

        let width = 0
        let height = 0
        const isVideo = VIDEO_EXTENSIONS.includes(ext)

        if (!isVideo) {
          const metadata = await sharp(filePath).metadata()
          width = metadata.width || 0
          height = metadata.height || 0
        }

        const meta: ImageMeta = {
          fileName: decodedFileName,
          order: extractOrderFromName(decodedFileName),
          width,
          height,
          size: stats.size,
          path: path.join(decodedTargetRelDir, decodedFileName).replace(/\\/g, '/')
        }

        return NextResponse.json({ success: true, meta: [meta] })
      } catch (err) {
        console.error('Error processing image metadata:', err)
        throw err
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Upload chunk error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const fileName = url.searchParams.get('fileName')
    const targetDir = url.searchParams.get('targetDir')

    if (!fileName || !targetDir) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    const decodedFileName = decodeURIComponent(fileName)
    const decodedTargetDir = decodeURIComponent(targetDir)

    try {
      assertSafeFileName(decodedFileName)
    } catch (error) {
      if (error instanceof UnsafePathError) {
        return NextResponse.json({ error: 'Invalid file name' }, { status: 400 })
      }
      throw error
    }

    // Security check
    const scanRoot = await getScanPath()
    if (!scanRoot) return NextResponse.json({ error: 'Config error' }, { status: 500 })

    let filePath: string
    try {
      const resolvedTargetDir = await resolveCreatablePathWithinRoot(scanRoot, decodedTargetDir)
      filePath = await resolveCreatablePathWithinRoot(scanRoot, path.join(resolvedTargetDir, decodedFileName))
    } catch (error) {
      if (error instanceof UnsafePathError) {
        return NextResponse.json({ error: 'Denied' }, { status: 403 })
      }
      throw error
    }

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath)
      return NextResponse.json({ exists: true, size: stats.size })
    }

    return NextResponse.json({ exists: false, size: 0 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

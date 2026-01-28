import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { Readable } from 'stream'
import { getScanPath } from '@/services/setting.service'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import { ImageMeta } from '@/services/artwork-service/image-manager'

export async function POST(req: NextRequest) {
  try {
    const fileName = req.headers.get('x-file-name')
    const targetDir = req.headers.get('x-target-dir')
    const targetRelDir = req.headers.get('x-target-rel-dir')
    const chunkIndexStr = req.headers.get('x-chunk-index')
    const totalChunksStr = req.headers.get('x-total-chunks')

    if (!fileName || !targetDir) {
      return NextResponse.json({ error: 'Missing required headers' }, { status: 400 })
    }

    const chunkIndex = parseInt(chunkIndexStr || '0')
    const totalChunks = parseInt(totalChunksStr || '1')

    // Decode headers
    const decodedFileName = decodeURIComponent(fileName)
    const decodedTargetDir = decodeURIComponent(targetDir)
    const decodedTargetRelDir = targetRelDir ? decodeURIComponent(targetRelDir) : ''

    // 1. 安全校验：防止路径遍历
    const scanRoot = await getScanPath()
    if (!scanRoot) {
      return NextResponse.json({ error: 'Server configuration error: SCAN_ROOT not set' }, { status: 500 })
    }

    // 使用 path.resolve 规范化路径，处理相对路径符 (..)
    const resolvedTargetDir = path.resolve(decodedTargetDir)
    const resolvedRoot = path.resolve(scanRoot)

    // 检查目标路径是否在 SCAN_ROOT 之下
    // 注意：Windows 下不区分大小写，但 path.resolve 已经处理了分隔符
    if (!resolvedTargetDir.startsWith(resolvedRoot)) {
      console.error(`Security blocked: Attempt to upload to ${resolvedTargetDir} which is outside ${resolvedRoot}`)
      return NextResponse.json({ error: 'Permission denied: Invalid target directory' }, { status: 403 })
    }

    const filePath = path.join(resolvedTargetDir, decodedFileName)

    // Ensure the body is present
    if (!req.body) {
      return NextResponse.json({ error: 'No body provided' }, { status: 400 })
    }

    // 2. 修复追加写入的 Bug：第一片使用覆盖('w')，后续使用追加('a')
    const flags = chunkIndex === 0 ? 'w' : 'a'

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
    const writeStream = fs.createWriteStream(filePath, { flags })

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
        const metadata = await sharp(filePath).metadata()
        const stats = fs.statSync(filePath)

        const meta: ImageMeta = {
          fileName: decodedFileName,
          order: extractOrderFromName(decodedFileName),
          width: metadata.width || 0,
          height: metadata.height || 0,
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

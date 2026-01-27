// oxlint-disable max-nested-callbacks
import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import busboy from 'busboy'
import sharp from 'sharp'
import { Readable } from 'stream'
import { getScanPath } from '@/services/setting.service'
import { updateArtworkImagesTransaction, ImageMeta } from '@/services/artwork-service/image-manager'
import { MEDIA_EXTENSIONS } from '../../../../../../lib/constant'
import { getArtworkById } from '@/services/artwork-service'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'

// 定义 API 支持的操作类型
type ActionType = 'init' | 'upload' | 'commit' | 'rollback'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artworkId = Number(id)
  const searchParams = req.nextUrl.searchParams
  const action = (searchParams.get('action') as ActionType) || 'init'

  // 1. 基础校验
  if (!artworkId || isNaN(artworkId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
  }
  const scanRoot = await getScanPath()
  if (!scanRoot) return NextResponse.json({ error: 'No SCAN_ROOT' }, { status: 500 })

  const artwork = await getArtworkById(artworkId)
  if (!artwork) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 2. 确定路径
  let targetRelDir = ''
  if (artwork.images && artwork.images.length > 0 && artwork.images[0]?.path) {
    targetRelDir = path.dirname(artwork.images[0].path)
  } else if (artwork.artist?.userId && artwork.externalId) {
    targetRelDir = `/${artwork.artist.userId}/${artwork.externalId}`
  } else {
    return NextResponse.json({ error: 'Cannot determine path' }, { status: 400 })
  }

  const targetDir = path.join(scanRoot, targetRelDir)
  const backupDir = path.join(targetDir, `.bak_session`) // 固定备份目录名，方便会话内复用

  try {
    // ==========================================
    // Phase 1: 初始化 (备份旧文件)
    // ==========================================
    if (action === 'init') {
      if (!fs.existsSync(targetDir)) {
        await fsPromises.mkdir(targetDir, { recursive: true })
      } else {
        // 如果存在上次未清理的备份，先还原或清理，这里简单处理为：如果有备份则认为已备份
        if (!fs.existsSync(backupDir)) {
          await fsPromises.mkdir(backupDir, { recursive: true })
          const existingFiles = await fsPromises.readdir(targetDir)
          for (const f of existingFiles) {
            // 排除备份文件夹本身
            if (f === '.bak_session') continue

            const ext = path.extname(f).toLowerCase()
            if (MEDIA_EXTENSIONS.includes(ext)) {
              await fsPromises.rename(path.join(targetDir, f), path.join(backupDir, f))
            }
          }
        }
      }
      return NextResponse.json({ success: true, message: 'Initialized & Backed up' })
    }

    // ==========================================
    // Phase 2: 分批上传 (流式写入)
    // ==========================================
    if (action === 'upload') {
      const headers: any = {}
      for (const [key, value] of req.headers.entries()) headers[key] = value
      const bb = busboy({ headers })

      const filesMeta: ImageMeta[] = []
      const filePromises: Promise<void>[] = []

      bb.on('file', (name, file, info) => {
        const { filename } = info
        const savePath = path.join(targetDir, filename)

        const p = new Promise<void>((resolve, reject) => {
          const writeStream = fs.createWriteStream(savePath)
          file.on('error', reject)
          writeStream.on('error', reject)

          // 使用 sharp 流式获取元数据
          const pipeline = sharp()
          pipeline
            .metadata()
            .then((metadata) => {
              filesMeta.push({
                fileName: filename,
                // 注意：这里我们不立即生成 Order，而是返回给前端，由前端最终汇总
                order: extractOrderFromName(filename),
                width: metadata.width || 0,
                height: metadata.height || 0,
                size: metadata.size || 0,
                path: path.join(targetRelDir, filename).replace(/\\/g, '/')
              })
            })
            .catch((err) => console.warn('Sharp meta error:', err))

          file
            .pipe(pipeline)
            .pipe(writeStream)
            .on('finish', () => {
              // 再次确认文件大小（sharp流可能不准）
              fsPromises
                .stat(savePath)
                .then((stats) => {
                  const meta = filesMeta.find((m) => m.fileName === filename)
                  if (meta) meta.size = stats.size
                  resolve()
                })
                .catch(reject)
            })
        })
        filePromises.push(p)
      })

      // 将 Web Stream 转 Node Stream
      // @ts-ignore
      Readable.fromWeb(req.body as any).pipe(bb)

      return new Promise((resolve) => {
        bb.on('finish', async () => {
          try {
            await Promise.all(filePromises)
            // 返回这一批次上传成功的文件的元数据
            resolve(NextResponse.json({ success: true, meta: filesMeta }))
          } catch (error: any) {
            resolve(NextResponse.json({ error: error.message }, { status: 500 }))
          }
        })
        bb.on('error', (err: any) =>
          resolve(NextResponse.json({ error: err?.message || 'Busboy error' }, { status: 500 }))
        )
      })
    }

    // ==========================================
    // Phase 3: 提交 (数据库更新 & 清理)
    // ==========================================
    if (action === 'commit') {
      // 从 Body 获取前端汇总的所有 metadata
      const body = await req.json()
      const allFilesMeta: ImageMeta[] = body.filesMeta

      if (!allFilesMeta || !Array.isArray(allFilesMeta)) {
        throw new Error('Invalid commit data')
      }

      // 重新排序
      allFilesMeta.sort((a, b) => a.order - b.order)

      // 执行数据库事务
      await updateArtworkImagesTransaction(artworkId, allFilesMeta)

      // 删除备份
      await fsPromises.rm(backupDir, { recursive: true, force: true }).catch(console.error)

      return NextResponse.json({ success: true })
    }

    // ==========================================
    // Phase 4: 回滚 (恢复备份)
    // ==========================================
    if (action === 'rollback') {
      // 1. 删除当前目录下的所有媒体文件（这些是上传失败产生的新文件）
      const currentFiles = await fsPromises.readdir(targetDir)
      for (const f of currentFiles) {
        if (f === '.bak_session') continue
        await fsPromises.unlink(path.join(targetDir, f)).catch(() => {})
      }

      // 2. 将 .bak_session 里的东西移回来
      if (fs.existsSync(backupDir)) {
        const backupFiles = await fsPromises.readdir(backupDir)
        for (const f of backupFiles) {
          await fsPromises.rename(path.join(backupDir, f), path.join(targetDir, f))
        }
        await fsPromises.rmdir(backupDir)
      }
      return NextResponse.json({ success: true, message: 'Rolled back' })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('API Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

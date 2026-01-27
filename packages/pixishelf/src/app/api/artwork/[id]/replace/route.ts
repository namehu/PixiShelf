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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artworkId = Number(id)

  if (!artworkId || isNaN(artworkId)) {
    return NextResponse.json({ error: 'Invalid artwork ID' }, { status: 400 })
  }

  const artwork = await getArtworkById(artworkId)
  if (!artwork) {
    return NextResponse.json({ error: 'Artwork not found' }, { status: 404 })
  }

  const scanRoot = await getScanPath()
  if (!scanRoot) {
    return NextResponse.json({ error: 'SCAN_ROOT not configured' }, { status: 500 })
  }

  try {
    // 确定目标目录
    let targetRelDir = ''

    // 1. 优先尝试沿用现有路径
    if (artwork.images && artwork.images.length > 0 && artwork.images[0]?.path) {
      targetRelDir = path.dirname(artwork.images[0].path)
    }
    // 2. 如果是空作品，根据标准规则生成新路径: /{artistId}/{externalId}
    else {
      // 这里的 artist 获取取决于你的 getArtworkById 实现，确保它 include 了 artist
      // 如果 artwork 对象里没有 artist，可能需要额外查询一次
      if (artwork.artist && artwork.artist.userId && artwork.externalId) {
        targetRelDir = `/${artwork.artist.userId}/${artwork.externalId}`
      } else {
        // 如果连作者ID和外部ID都没有，那就是脏数据了
        return NextResponse.json({ error: '无法确定目标路径: 缺少作者ID或外部ID' }, { status: 400 })
      }
    }

    const targetDir = path.join(scanRoot, targetRelDir)
    const backupDir = path.join(targetDir, `.bak_${Date.now()}`)

    //  物理备份
    if (!fs.existsSync(targetDir)) {
      await fsPromises.mkdir(targetDir, { recursive: true })
    } else {
      await fsPromises.mkdir(backupDir, { recursive: true })
      const existingFiles = await fsPromises.readdir(targetDir)

      for (const f of existingFiles) {
        if (f.startsWith('.bak_')) continue

        const ext = path.extname(f).toLowerCase()
        if (MEDIA_EXTENSIONS.includes(ext)) {
          const srcPath = path.join(targetDir, f)
          const destPath = path.join(backupDir, f)
          await fsPromises.rename(srcPath, destPath)
        }
      }
    }

    // 5. Busboy 流式处理 (App Router 适配)
    // 将 Web Request Headers 转换为 Node Headers 对象，供 busboy 使用
    const headers: any = {}
    req.headers.forEach((value, key) => {
      headers[key] = value
    })

    const bb = busboy({ headers })
    const filesMeta: ImageMeta[] = []
    const filePromises: Promise<void>[] = []
    const newFilePaths: string[] = []

    // 监听文件事件
    bb.on('file', (name, file, info) => {
      const { filename } = info
      const savePath = path.join(targetDir, filename)
      newFilePaths.push(savePath)

      const p = new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(savePath)
        file.pipe(writeStream)

        writeStream.on('finish', async () => {
          try {
            // 获取图片元数据
            const metadata = await sharp(savePath).metadata()
            const order = extractOrderFromName(filename)

            filesMeta.push({
              fileName: filename,
              order: order,
              width: metadata.width || 0,
              height: metadata.height || 0,
              size: metadata.size || 0,
              path: path.join(targetRelDir, filename).replace(/\\/g, '/')
            })

            // 补全文件大小
            const stats = await fsPromises.stat(savePath)
            const metaIndex = filesMeta.findIndex((m) => m.fileName === filename)
            if (metaIndex !== -1 && filesMeta[metaIndex]) {
              filesMeta[metaIndex]!.size = stats.size
            }

            resolve()
          } catch (err) {
            reject(err)
          }
        })

        writeStream.on('error', reject)
      })

      filePromises.push(p)
    })

    // 创建 Promise 等待 busboy 处理完成
    const processing = new Promise<NextResponse>((resolve, reject) => {
      bb.on('finish', async () => {
        try {
          await Promise.all(filePromises)

          // 数据库事务更新
          filesMeta.sort((a, b) => a.order - b.order)
          await updateArtworkImagesTransaction(artworkId, filesMeta)

          // 成功后异步删除备份
          fsPromises.rm(backupDir, { recursive: true, force: true }).catch(console.error)

          resolve(NextResponse.json({ success: true, count: filesMeta.length }))
        } catch (err: any) {
          console.error('Replace transaction failed:', err)

          // 失败回滚：删除新文件
          for (const f of newFilePaths) {
            try {
              await fsPromises.unlink(f)
            } catch {}
          }

          // 还原备份
          if (fs.existsSync(backupDir)) {
            const backupFiles = await fsPromises.readdir(backupDir)
            for (const f of backupFiles) {
              await fsPromises.rename(path.join(backupDir, f), path.join(targetDir, f))
            }
            await fsPromises.rmdir(backupDir)
          }

          resolve(
            NextResponse.json(
              {
                error: 'Transaction failed, rolled back.',
                details: err.message
              },
              { status: 500 }
            )
          )
        }
      })

      bb.on('error', (err: any) => {
        resolve(NextResponse.json({ error: err?.message || 'Busboy error' }, { status: 500 }))
      })
    })

    // 关键步骤：将 Web ReadableStream 转换为 Node Readable Stream 并管道给 Busboy
    // @ts-ignore: Readable.fromWeb 在 Node 环境中可用
    const nodeStream = Readable.fromWeb(req.body as any)
    nodeStream.pipe(bb)

    return await processing
  } catch (error: any) {
    console.error('API Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

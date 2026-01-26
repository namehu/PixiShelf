import type { NextApiRequest, NextApiResponse } from 'next'
import busboy from 'busboy'
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import sharp from 'sharp'
import { getScanPath } from '@/services/setting.service'
import { updateArtworkImagesTransaction, ImageMeta } from '@/services/artwork-service/image-manager'
import { MEDIA_EXTENSIONS } from '../../../../../lib/constant'

// 禁用 Next.js 默认的 BodyParser 以支持流式上传
export const config = {
  api: {
    bodyParser: false
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const artworkId = Number(req.query.id)
  const relativePath = req.query.path as string

  if (!artworkId || isNaN(artworkId)) {
    return res.status(400).json({ error: 'Invalid artwork ID' })
  }

  try {
    const scanRoot = await getScanPath()
    if (!scanRoot) {
      return res.status(500).json({ error: 'SCAN_ROOT not configured' })
    }

    // 1. 确定目标目录
    // 如果前端传了 path (firstImagePath)，则使用其目录；否则尝试构建 (但这里主要依赖前端传参)
    // 注意：path 是数据库存的相对路径，如 "12345/12345_p0.jpg"
    let targetRelDir = ''
    if (relativePath) {
      targetRelDir = path.dirname(relativePath)
    } else {
      return res.status(400).json({ error: 'Missing path parameter' })
    }

    // 防止目录遍历攻击
    if (targetRelDir.includes('..') || path.isAbsolute(targetRelDir)) {
      return res.status(400).json({ error: 'Invalid path' })
    }

    const targetDir = path.join(scanRoot, targetRelDir)
    const backupDir = path.join(targetDir, `.bak_${Date.now()}`)

    // 2. 物理备份
    // 仅备份媒体文件，保留 .txt 等元数据文件
    if (fs.existsSync(targetDir)) {
      await fsPromises.mkdir(backupDir, { recursive: true })
      const existingFiles = await fsPromises.readdir(targetDir)

      for (const f of existingFiles) {
        // 跳过备份目录本身
        if (f.startsWith('.bak_')) continue

        const ext = path.extname(f).toLowerCase()
        // 仅备份支持的媒体文件
        if (MEDIA_EXTENSIONS.includes(ext)) {
          const srcPath = path.join(targetDir, f)
          const destPath = path.join(backupDir, f)
          // 移动文件 (rename)
          await fsPromises.rename(srcPath, destPath)
        }
      }
    } else {
      // 目标目录不存在，创建它
      await fsPromises.mkdir(targetDir, { recursive: true })
    }

    // 3. Busboy 流式处理
    const bb = busboy({ headers: req.headers })
    const filesMeta: ImageMeta[] = []
    const filePromises: Promise<void>[] = []
    const newFilePaths: string[] = [] // 记录新生成的文件路径，用于回滚

    bb.on('file', (name, file, info) => {
      const { filename } = info
      const savePath = path.join(targetDir, filename)
      newFilePaths.push(savePath)

      const p = new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(savePath)

        file.pipe(writeStream)

        writeStream.on('finish', async () => {
          try {
            // 文件写入完成后，使用 Sharp 获取元数据
            // 串行 Sharp: 此时文件已在磁盘，读取它不会占用大量内存 (Sharp 是流式的或高效的)
            const metadata = await sharp(savePath).metadata()

            // 提取 Order
            const order = extractOrder(filename)

            // 记录元数据
            filesMeta.push({
              fileName: filename,
              order: order,
              width: metadata.width || 0,
              height: metadata.height || 0,
              size: metadata.size || 0, // Sharp metadata 可能不包含 size (文件大小)，需要 fs.stat
              path: path.join(targetRelDir, filename).replace(/\\/g, '/') // 存入 DB 的相对路径
            })

            // 补全 size (Sharp metadata.size 是输出大小，不一定是文件大小，这里用 fs.stat 更准)
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

    bb.on('finish', async () => {
      try {
        // 等待所有文件处理完成
        await Promise.all(filePromises)

        // 4. 数据库事务更新
        // 按 order 排序，确保 DB 顺序正确
        filesMeta.sort((a, b) => a.order - b.order)

        await updateArtworkImagesTransaction(artworkId, filesMeta)

        // 5. 成功：异步删除备份
        // 不 await，让它在后台运行
        fsPromises.rm(backupDir, { recursive: true, force: true }).catch(console.error)

        res.status(200).json({ success: true, count: filesMeta.length })
      } catch (err: any) {
        console.error('Replace transaction failed:', err)

        // 6. 失败：回滚
        // A. 删除新上传的文件
        for (const f of newFilePaths) {
          try {
            await fsPromises.unlink(f)
          } catch {}
        }

        // B. 还原备份
        if (fs.existsSync(backupDir)) {
          const backupFiles = await fsPromises.readdir(backupDir)
          for (const f of backupFiles) {
            await fsPromises.rename(path.join(backupDir, f), path.join(targetDir, f))
          }
          // 移除备份目录
          await fsPromises.rmdir(backupDir)
        }

        res.status(500).json({ error: 'Transaction failed, rolled back.', details: err.message })
      }
    })

    req.pipe(bb)
  } catch (error: any) {
    console.error('API Error:', error)
    res.status(500).json({ error: error.message })
  }
}

/**
 * 从文件名提取排序序号
 * 规则: /[-_](\d+)(?=\.\w+$)|(\d+)(?=\.\w+$)/
 */
function extractOrder(fileName: string): number {
  const match = fileName.match(/[-_](\d+)|(\d+)/g)
  if (match) {
    const lastMatch = match[match.length - 1]
    return parseInt(lastMatch.replace(/[-_]/, ''), 10)
  }
  return 0
}

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { Readable } from 'stream'
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

    const filePath = path.join(decodedTargetDir, decodedFileName)

    // Ensure the body is present
    if (!req.body) {
      return NextResponse.json({ error: 'No body provided' }, { status: 400 })
    }

    // Convert Web Stream to Node Stream
    // @ts-ignore: Readable.fromWeb is available in Node 18+ which Next.js 16 uses
    const nodeStream = Readable.fromWeb(req.body)
    const writeStream = fs.createWriteStream(filePath, { flags: 'a' })

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

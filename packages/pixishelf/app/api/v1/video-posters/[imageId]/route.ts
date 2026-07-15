import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getVideoPosterPath } from '@/services/video-poster-service'

const POSTER_ROOT = process.env.VIDEO_POSTER_STORAGE_PATH || '/app/video-posters'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId: rawImageId } = await params
  const imageId = Number(rawImageId)
  if (!Number.isSafeInteger(imageId) || imageId <= 0) return NextResponse.json({ error: 'Invalid image id' }, { status: 400 })

  const relativePath = await getVideoPosterPath(imageId)
  if (!relativePath || path.basename(relativePath) !== relativePath) return NextResponse.json({ error: 'Poster not found' }, { status: 404 })
  const absolutePath = path.join(POSTER_ROOT, relativePath)
  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) return NextResponse.json({ error: 'Poster not found' }, { status: 404 })
    const headers = new Headers({
      'Content-Type': 'image/webp',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable'
    })
    // @ts-expect-error NextResponse accepts a Node stream at runtime.
    return new NextResponse(createReadStream(absolutePath), { headers })
  } catch {
    return NextResponse.json({ error: 'Poster not found' }, { status: 404 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getArtworkById } from '@/services/artwork-service'
import logger from '@/lib/logger'
import z from 'zod'

const RouteParamsSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer')
})

/**
 * /api/artworks/[id]
 * 获取单个作品详情
 *
 * @param _req
 * @param param1
 * @returns
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> } // Next.js 15+ params 是 Promise
) {
  const validation = RouteParamsSchema.safeParse(await params)

  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid ID', details: z.treeifyError(validation.error) }, { status: 400 })
  }

  const { id } = validation.data

  try {
    const data = await getArtworkById(id)
    if (!data) {
      return NextResponse.json({ statusCode: 404, error: 'Not Found', message: 'Artwork not found' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error) {
    logger.error(`[API] Get Artwork Failed (id:${id}):`, error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

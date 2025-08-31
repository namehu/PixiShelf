import { FastifyInstance } from 'fastify'
import path from 'path'
import fs from 'fs'
import mime from 'mime-types'

export default async function imagesRoutes(server: FastifyInstance) {
  server.get('/api/v1/images/*', async (req, reply) => {
    const scanRoot = await server.settingService.getScanPath()
    if (!scanRoot) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
    }

    const antiHotlink = (process.env.ANTI_HOTLINK || 'false').toLowerCase() === 'true'
    const allowedReferers = (process.env.ALLOWED_IMAGE_REFERERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    void antiHotlink
    void allowedReferers

    const wildcard = (req.params as any)['*'] as string
    if (!wildcard) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing image path' })

    let decoded = wildcard
    try {
      decoded = decodeURIComponent(wildcard)
    } catch {}

    const platformPath = decoded.replace(/\\/g, '/').split('/').filter(Boolean).join('/')

    let absPath = '/' + platformPath
    if (!absPath.startsWith(scanRoot)) {
      absPath = path.resolve(scanRoot, platformPath)
    }

    if (!absPath.startsWith(path.resolve(scanRoot))) {
      return reply
        .code(403)
        .send({ statusCode: 403, error: 'Forbidden', message: 'Access outside scan root is not allowed' })
    }

    if (!fs.existsSync(absPath)) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Image not found' })
    }

    const stat = fs.statSync(absPath)
    if (!stat.isFile()) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Not a file' })
    }

    const lastModified = stat.mtime.toUTCString()
    const etag = `W/"${stat.size}-${stat.mtimeMs}"`
    reply.header('Last-Modified', lastModified)
    reply.header('ETag', etag)
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')

    const ifNoneMatch = req.headers['if-none-match']
    const ifModifiedSince = req.headers['if-modified-since']
    if (
      (ifNoneMatch && ifNoneMatch === etag) ||
      (ifModifiedSince && new Date(ifModifiedSince).getTime() >= stat.mtime.getTime())
    ) {
      return reply.code(304).send()
    }

    const mimeType = mime.lookup(absPath) || 'application/octet-stream'
    const data = await fs.promises.readFile(absPath)
    reply.header('Content-Type', mimeType)
    reply.header('Content-Length', String(data.length))
    return reply.send(data)
  })
}

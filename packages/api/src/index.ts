import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { FileScanner } from './services/scanner'
import cron from 'node-cron'
import path from 'path'
import fs from 'fs'
import mime from 'mime-types'
import { SettingService } from './services/setting'

dotenv.config()

const server = Fastify({
  logger: true,
})

await server.register(cors, {
  origin: true,
})

// Initialize Prisma Client and connect to DB
const prisma = new PrismaClient()
try {
  await prisma.$connect()
  server.log.info('Prisma connected to database successfully')
} catch (err) {
  server.log.error({ err }, 'Failed to connect to database with Prisma')
}

const settingService = new SettingService(prisma)
await settingService.initDefaults()

// 扫描任务控制
let scanning = false
let cancelRequested = false
let lastProgressMessage: string | null = null

// Unified error handler
server.setErrorHandler((error, _req, reply) => {
  const statusCode = (error as any).statusCode || 500
  const message = error.message || 'Internal Server Error'
  server.log.error({ err: error }, 'Request failed')
  reply.code(statusCode).send({ statusCode, error: statusCode === 500 ? 'Internal Server Error' : 'Bad Request', message })
})

// API key auth preHandler for protected routes
server.addHook('preHandler', async (req, reply) => {
  // always allow image serving without API key
  if (typeof req.url === 'string' && req.url.startsWith('/api/v1/images/')) return

  const openPaths = [
    { method: 'GET', url: '/api/v1/health' },
  ] as const
  const isOpen = openPaths.some((p) => {
    if (p.method !== req.method) return false
    if (typeof p.url === 'string') return p.url === req.url
    return (p.url as any).test ? (p.url as any).test(req.url) : false
  })
  if (isOpen) return

  const apiKey = process.env.API_KEY
  const header = req.headers['authorization'] || req.headers['x-api-key']
  let token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : typeof header === 'string' ? header : undefined
  if (!token) {
    const q: any = (req as any).query || {}
    token = q.apiKey || q.token
  }

  if (!apiKey || token !== apiKey) {
    reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid API key' })
  }
})

// Health check
server.get('/api/v1/health', async () => ({ status: 'ok', scanPath: await settingService.getScanPath() }))

// 扫描状态
server.get('/api/v1/scan/status', async () => ({ scanning, message: lastProgressMessage }))

// Settings endpoints for scanPath
server.get('/api/v1/settings/scan-path', async () => {
  const value = await settingService.getScanPath()
  return { scanPath: value }
})

server.put('/api/v1/settings/scan-path', async (req, reply) => {
  const body = req.body as { scanPath?: string }
  const scanPath = body?.scanPath?.trim()
  if (!scanPath) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'scanPath is required' })
  await settingService.setScanPath(scanPath)
  return { success: true }
})

// Manual scan endpoint
server.post('/api/v1/scan', async (req, reply) => {
  const scanPath = await settingService.getScanPath()
  if (!scanPath) {
    reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
    return
  }

  if (scanning) {
    return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Scan already in progress' })
  }
  cancelRequested = false
  scanning = true
  lastProgressMessage = '初始化…'
  try {
    const body = req.body as { force?: boolean }
    const forceUpdate = body?.force === true

    const scanner = new FileScanner(prisma, server.log)
    const result = await scanner.scan({
      scanPath,
      forceUpdate,
      onProgress: (p) => {
        lastProgressMessage = p?.message || null
        if (cancelRequested) {
          throw new Error('Scan cancelled')
        }
      }
    })
    return { success: true, result }
  } catch (err: any) {
    if (err?.message === 'Scan cancelled') {
      return reply.code(499).send({ statusCode: 499, error: 'Client Closed Request', message: 'Scan cancelled' })
    }
    throw err
  } finally {
    scanning = false
    lastProgressMessage = null
  }
})

server.post('/api/v1/scan/cancel', async (_req, _reply) => {
  if (!scanning) return { success: true, cancelled: false }
  cancelRequested = true
  lastProgressMessage = '正在取消…'
  return { success: true, cancelled: true }
})

// SSE endpoint for scan progress (with cancel)
server.get('/api/v1/scan/stream', async (req, reply) => {
  const scanPath = await settingService.getScanPath()
  if (!scanPath) {
    reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
    return
  }

  const { force } = req.query as { force?: string }
  const forceUpdate = force === 'true'

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  })

  const sendEvent = (event: string, data: any) => {
    reply.raw.write(`event: ${event}\n`)
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  if (scanning) {
    sendEvent('error', { success: false, error: 'Scan already in progress' })
    reply.raw.end()
    return
  }

  scanning = true
  cancelRequested = false
  lastProgressMessage = '初始化…'

  try {
    const scanner = new FileScanner(prisma, server.log)

    const result = await scanner.scan({
      scanPath,
      forceUpdate,
      onProgress: (progress) => {
        lastProgressMessage = progress?.message || null
        if (cancelRequested) {
          throw new Error('Scan cancelled')
        }
        sendEvent('progress', progress)
      }
    })

    sendEvent('complete', { success: true, result })
  } catch (error: any) {
    if (error?.message === 'Scan cancelled') {
      sendEvent('cancelled', { success: false, error: 'Scan cancelled' })
    } else {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      sendEvent('error', { success: false, error: errorMsg })
    }
  } finally {
    scanning = false
    lastProgressMessage = null
  }

  reply.raw.end()
})

// Basic list endpoints (skeleton)
server.get('/api/v1/artworks', async (req) => {
  const { page = '1', pageSize = '20' } = req.query as Record<string, string>
  const skip = (parseInt(page) - 1) * parseInt(pageSize)
  const take = parseInt(pageSize)
  const [items, total] = await Promise.all([
    prisma.artwork.findMany({
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        images: {
          take: 1,
          orderBy: { id: 'asc' },
        },
        artist: true,
        _count: { select: { images: true } },
      },
    }),
    prisma.artwork.count(),
  ])
  return { items, total, page: Number(page), pageSize: Number(pageSize) }
})

server.get('/api/v1/artworks/:id', async (req, reply) => {
  const { id } = req.params as { id: string }
  const artwork = await prisma.artwork.findUnique({
    where: { id: Number(id) },
    include: { images: true, artist: true },
  })
  if (!artwork) return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Artwork not found' })
  return artwork
})

server.get('/api/v1/artists', async () => {
  const artists = await prisma.artist.findMany({ orderBy: { name: 'asc' } })
  return { items: artists }
})

// Secure image serving
server.get('/api/v1/images/*', async (req, reply) => {
  const scanRoot = await settingService.getScanPath()
  if (!scanRoot) {
    return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
  }

  const antiHotlink = (process.env.ANTI_HOTLINK || 'false').toLowerCase() === 'true'
  const allowedReferers = (process.env.ALLOWED_IMAGE_REFERERS || '').split(',').map(s => s.trim()).filter(Boolean)

  const wildcard = (req.params as any)['*'] as string
  if (!wildcard) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing image path' })

  let decoded = wildcard
  try {
    decoded = decodeURIComponent(wildcard)
  } catch {}

  const platformPath = decoded.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  const absPath = path.resolve(scanRoot, platformPath)

  if (!absPath.startsWith(path.resolve(scanRoot))) {
    return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Access outside scan root is not allowed' })
  }

  if (!fs.existsSync(absPath)) {
    return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Image not found' })
  }

  const stat = fs.statSync(absPath)
  if (!stat.isFile()) {
    return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Not a file' })
  }

  // Caching headers
  const lastModified = stat.mtime.toUTCString()
  const etag = `W/"${stat.size}-${stat.mtimeMs}"`
  reply.header('Last-Modified', lastModified)
  reply.header('ETag', etag)
  reply.header('Cache-Control', 'public, max-age=31536000, immutable')

  const ifNoneMatch = req.headers['if-none-match']
  const ifModifiedSince = req.headers['if-modified-since']
  if ((ifNoneMatch && ifNoneMatch === etag) || (ifModifiedSince && new Date(ifModifiedSince).getTime() >= stat.mtime.getTime())) {
    return reply.code(304).send()
  }

  const mimeType = mime.lookup(absPath) || 'application/octet-stream'
  const data = await fs.promises.readFile(absPath)
  reply.header('Content-Type', mimeType)
  reply.header('Content-Length', String(data.length))
  return reply.send(data)
})

// Start server
const port = Number(process.env.PORT) || 3002
const host = process.env.HOST || '0.0.0.0'

server
  .listen({ port, host })
  .then((address) => {
    server.log.info(`Server listening at ${address}`)
  })
  .catch((err) => {
    server.log.error(err)
    process.exit(1)
  })
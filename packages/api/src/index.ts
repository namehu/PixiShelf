import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { FileScanner } from './services/scanner'
import cron from 'node-cron'
import path from 'path'
import fs from 'fs'
import mime from 'mime-types'

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

// Unified error handler
server.setErrorHandler((error, _req, reply) => {
  const statusCode = (error as any).statusCode || 500
  const message = error.message || 'Internal Server Error'
  server.log.error({ err: error }, 'Request failed')
  reply.code(statusCode).send({ statusCode, error: statusCode === 500 ? 'Internal Server Error' : 'Bad Request', message })
})

// API key auth preHandler for protected routes
server.addHook('preHandler', async (req, reply) => {
  // 仅保护非 GET /health 和 GET /images/* 的 API
  const openPaths = [
    { method: 'GET', url: '/api/v1/health' },
    { method: 'GET', url: /^\/api\/v1\/images\// },
  ] as const
  const isOpen = openPaths.some((p) => {
    if (p.method !== req.method) return false
    if (typeof p.url === 'string') return p.url === req.url
    return p.url.test(req.url)
  })
  if (isOpen) return

  const apiKey = process.env.API_KEY
  const header = req.headers['authorization'] || req.headers['x-api-key']
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : typeof header === 'string' ? header : undefined

  if (!apiKey || token !== apiKey) {
    reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid API key' })
  }
})

// Health check
server.get('/api/v1/health', async () => ({ status: 'ok', scanPath: process.env.SCAN_PATH || null }))

// Manual scan endpoint
server.post('/api/v1/scan', async (req, reply) => {
  const scanPath = process.env.SCAN_PATH
  if (!scanPath) {
    reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
    return
  }
  const scanner = new FileScanner(prisma, server.log)
  const result = await scanner.scan({ scanPath })
  return { success: true, result }
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
  const scanRoot = process.env.SCAN_PATH
  if (!scanRoot) {
    return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
  }

  const antiHotlink = (process.env.ANTI_HOTLINK || 'false').toLowerCase() === 'true'
  const allowedReferers = (process.env.ALLOWED_IMAGE_REFERERS || '').split(',').map(s => s.trim()).filter(Boolean)

  // param name is '*' for wildcard
  const wildcard = (req.params as any)['*'] as string
  if (!wildcard) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing image path' })

  // Normalize and prevent path traversal
  const platformPath = wildcard.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  const absPath = path.resolve(scanRoot, platformPath)
  const normalizedRoot = path.resolve(scanRoot)
  if (!absPath.startsWith(normalizedRoot)) {
    return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Invalid path' })
  }

  // Anti-hotlinking (basic)
  if (antiHotlink) {
    const referer = req.headers['referer'] as string | undefined
    if (!referer || (allowedReferers.length > 0 && !allowedReferers.some(prefix => referer.startsWith(prefix)))) {
      return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Hotlinking not allowed' })
    }
  }

  try {
    await fs.promises.access(absPath, fs.constants.R_OK)
    const stat = await fs.promises.stat(absPath)
    if (!stat.isFile()) return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'File not found' })

    const contentType = mime.lookup(absPath) || 'application/octet-stream'
    reply.header('Content-Type', contentType as string)
    reply.header('Content-Length', stat.size.toString())

    const stream = fs.createReadStream(absPath)
    return reply.send(stream)
  } catch (err) {
    server.log.warn({ err, absPath }, 'Failed to serve image')
    return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'File not found' })
  }
})

const port = Number(process.env.API_PORT || 3001)
const host = process.env.API_HOST || '0.0.0.0'

// Schedule cron job for periodic scans
const intervalHours = Number(process.env.SCAN_INTERVAL_HOURS || '0')
if (intervalHours > 0 && process.env.SCAN_PATH) {
  const cronExpr = `0 */${intervalHours} * * *`
  cron.schedule(cronExpr, async () => {
    try {
      const scanner = new FileScanner(prisma, server.log)
      await scanner.scan({ scanPath: process.env.SCAN_PATH! })
    } catch (err) {
      server.log.error({ err }, 'Scheduled scan failed')
    }
  })
  server.log.info(`Scheduled scan enabled: every ${intervalHours} hours`)
}

server.addHook('onClose', async () => {
  await prisma.$disconnect()
})

server
  .listen({ port, host })
  .then((address) => {
    server.log.info(`API server listening on ${address}`)
  })
  .catch((err) => {
    server.log.error(err)
    process.exit(1)
  })
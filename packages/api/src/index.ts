import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

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
  // do not exit; allow server to run but indicate degraded state
}

// Health check
server.get('/api/v1/health', async () => ({ status: 'ok' }))

const port = Number(process.env.API_PORT || 3001)
const host = process.env.API_HOST || '0.0.0.0'

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
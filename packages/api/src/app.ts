import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { SettingService } from './services/setting'
import { errorPlugin } from './plugins/error'
import { authPlugin } from './plugins/auth'
import registerRoutes from './routes'
import { AppState } from './types'

dotenv.config()

export async function buildServer() {
  const server = Fastify({ logger: true })

  await server.register(cors, { origin: true })

  // Prisma
  const prisma = new PrismaClient()
  try {
    await prisma.$connect()
    server.log.info('Prisma connected to database successfully')
  } catch (err) {
    server.log.error({ err }, 'Failed to connect to database with Prisma')
  }
  server.decorate('prisma', prisma)

  // Services
  const settingService = new SettingService(prisma)
  await settingService.initDefaults()
  server.decorate('settingService', settingService)

  // App state
  const appState: AppState = { scanning: false, cancelRequested: false, lastProgressMessage: null }
  server.decorate('appState', appState)

  // Plugins
  await errorPlugin(server)
  await authPlugin(server)

  // Routes
  await registerRoutes(server)

  return server
}
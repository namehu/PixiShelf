import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { SettingService } from './services/setting'
import { errorPlugin } from './plugins/error'
import { authPlugin } from './plugins/auth'
import responseTransformerPlugin from './plugins/response-transformer'
import registerRoutes from './routes'
import bcrypt from 'bcryptjs'
import { AppState } from '@pixishelf/shared'
import { fileURLToPath } from 'url'
import path from 'path'

// ES Module a little helper to get __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 30 days in milliseconds (30 * 24 * 60 * 60 * 1000)
const THIRTY_DAYS_IN_MS = 2592000000

dotenv.config()

export async function buildServer() {
  const server = Fastify({
    logger: {
      level: 'info', // 设置日志级别
      // 使用 transport 来重定向日志输出
      transport: {
        target: 'pino-roll', // 指定目标为 pino-roll
        options: {
          mkdir: true,
          // file: 定义日志文件路径和名称模式。
          // %d 会被替换成日期，格式由 dateFormat 决定。
          // 'log' 是文件夹名称，你可以自定义。
          file: path.join(__dirname, '../logs/app'),
          extension: '.log',
          // frequency: 定义滚动频率。'daily' 表示每天。
          // 也可以是 'hourly' 或 cron 表达式。
          frequency: 'daily',
          // dateFormat: 定义文件名中的日期格式。
          // 'YYYY-MM-DD' 会生成类似 'app-2023-10-27.log' 的文件。
          dateFormat: 'yyy-MM-dd',
          // size: 定义单个日志文件的最大大小。
          // 例如 '10M' 表示 10 MB。达到大小后也会触发滚动。
          // 如果你只想按日期滚动，可以不设置或设置一个较大的值。
          size: '10m',
          // maxage: 定义日志文件的最大保留时间（毫秒）。
          // 这里设置为 30 天，pino-roll 会自动删除超时的旧日志文件。
          maxage: THIRTY_DAYS_IN_MS
        }
      }
    }
  })

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

  // Initialize default admin (idempotent)
  try {
    const username = process.env.INIT_ADMIN_USERNAME || 'admin'
    const existing = await prisma.user.findFirst({ where: { username } })
    if (!existing) {
      const initialPassword = process.env.INIT_ADMIN_PASSWORD || 'admin123'
      const salt = await bcrypt.genSalt(10)
      const hash = await bcrypt.hash(initialPassword, salt)
      await prisma.user.create({ data: { username, password: hash } })
      server.log.warn('Initialized default admin account. Remember to change the password promptly.')
    }
  } catch (e) {
    server.log.error({ err: e }, 'Failed to initialize default admin user')
  }

  // Services
  const settingService = new SettingService(prisma)
  await settingService.initDefaults()
  server.decorate('settingService', settingService)

  // App state
  const appState: AppState = {
    scanning: false,
    cancelRequested: false,
    lastProgressMessage: null
  }
  server.decorate('appState', appState)

  // Plugins
  await errorPlugin(server)
  await authPlugin(server)
  await server.register(responseTransformerPlugin) // 注册自动日期转换插件

  // Routes
  await registerRoutes(server)

  return server
}

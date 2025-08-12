import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { SettingService } from '../services/setting'
import { 
  PaginationQuery, 
  ScanRequest, 
  ScanPathRequest,
  AppState 
} from '@pixishelf/shared'

// 扩展Fastify实例的类型
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
    settingService: SettingService
    appState: AppState
  }
  interface FastifyRequest {
    user?: { id: number; username: string }
  }
}

// 路由插件类型
export type RoutePlugin = (fastify: FastifyInstance) => Promise<void>

// 重新导出共享类型以保持向后兼容
export type { PaginationQuery, ScanRequest }
export type SettingsRequest = ScanPathRequest
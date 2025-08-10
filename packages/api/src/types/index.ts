import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { SettingService } from '../services/setting'

// 全局状态接口
export interface AppState {
  scanning: boolean
  cancelRequested: boolean
  lastProgressMessage: string | null
}

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

// 分页查询参数
export interface PaginationQuery {
  page?: string
  pageSize?: string
}

// 扫描请求体
export interface ScanRequest {
  force?: boolean
}

// 设置请求体
export interface SettingsRequest {
  scanPath?: string
}
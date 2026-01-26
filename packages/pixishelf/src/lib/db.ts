import Dexie, { Table } from 'dexie'

// 扩展日志级别以包含业务特定的状态
export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'connection' | 'progress' | 'complete' | 'cancelled'

export type LogModule = 'scan-server' | 'scan-client' | 'system' | 'migration-client'

export interface LogEntry {
  id?: number
  module: LogModule
  level: LogLevel
  message: string
  timestamp: number
  data?: any
}

export class PixiShelfDB extends Dexie {
  logs!: Table<LogEntry>

  constructor() {
    super('PixiShelfDB')
    this.version(1).stores({
      logs: '++id, module, level'
    })
    
    // Version 2: 添加 timestamp 索引以支持基于时间的查询和清理
    this.version(2).stores({
      logs: '++id, module, level, timestamp'
    })
  }
}

const globalForDb = globalThis as unknown as {
  pixiShelfDb: PixiShelfDB | undefined
}

export const db = globalForDb.pixiShelfDb ?? new PixiShelfDB()

if (process.env.NODE_ENV !== 'production') globalForDb.pixiShelfDb = db

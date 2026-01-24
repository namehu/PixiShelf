import Dexie, { type Table } from 'dexie'
import { PixivArtworkData } from '../../../types/pixiv'

export interface ArtworkItem {
  id: string
  status: 'pending' | 'running' | 'fulfilled' | 'rejected'
  data?: PixivArtworkData
  error?: string
  updatedAt: number
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error'
export type LogModule = 'artwork' | 'artist' | 'tag' | 'system'

export interface LogEntry {
  id?: number
  module: LogModule
  level: LogLevel
  message: string
  timestamp: number
}

export class PixiShelfDB extends Dexie {
  tasks!: Table<ArtworkItem>
  logs!: Table<LogEntry>

  constructor() {
    super('PixiShelfDB')
    this.version(1).stores({
      tasks: 'id, status'
    })
    
    // Add logs table in version 2
    this.version(2).stores({
      tasks: 'id, status',
      logs: '++id, module, level'
    })
  }
}

const _global = globalThis as any
export const db: PixiShelfDB = _global.pixiDb || new PixiShelfDB()

if (import.meta.env.DEV) {
  _global.pixiDb = db
}

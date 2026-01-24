import Dexie, { type Table } from 'dexie'
import { PixivArtworkData } from '../../../types/pixiv'

export interface ArtworkItem {
  id: string
  status: 'pending' | 'running' | 'fulfilled' | 'rejected'
  data?: PixivArtworkData
  error?: string
  updatedAt: number
}

export class PixiShelfDB extends Dexie {
  tasks!: Table<ArtworkItem>

  constructor() {
    super('PixiShelfDB')
    this.version(1).stores({
      tasks: 'id, status'
    })
  }
}

const _global = globalThis as any
export const db: PixiShelfDB = _global.pixiDb || new PixiShelfDB()

if (import.meta.env.DEV) {
  _global.pixiDb = db
}

// Repository 层统一导出
// 按照系统设计文档的规范，统一管理所有数据访问层

export { artworkRepository } from './artworkRepository'
export type { ArtworkRepository } from './artworkRepository'

// 现有的 Repository
export { userRepository } from './user'

// 未来可以添加其他 Repository
// export { tagRepository } from './tagRepository'
// export { artistRepository } from './artistRepository'
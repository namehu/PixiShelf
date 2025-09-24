// Services 层统一导出
// 按照系统设计文档的规范，统一管理所有业务逻辑服务

export { artworkService } from './artworkService'
export type { ArtworkService } from './artworkService'

// 未来可以添加其他服务
// export { userService } from './userService'
// export { tagService } from './tagService'
// export { artistService } from './artistService'
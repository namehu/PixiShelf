// Services 层统一导出
// 按照系统设计文档的规范，统一管理所有业务逻辑服务

export { artworkService } from './artworkService'

export { likeService } from './likeService'
export type { LikeService, LikeResult, LikeStatus } from './likeService'

// ============================================================================
// 工具类型
// ============================================================================

/**
 * 可选字段类型
 */
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * 创建类型（排除 id 和时间戳）
 */
export type CreateType<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>

/**
 * 更新类型（排除 id 和 createdAt）
 */
export type UpdateType<T> = Omit<T, 'id' | 'createdAt'>
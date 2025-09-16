// ============================================================================
// PixiShelf Next.js 应用类型定义
// ============================================================================

// 核心数据模型
export * from './core'

// API 相关类型
export * from './api'

// 认证相关类型（从专门的auth.ts文件导出）
export * from './auth'

// Next.js 特定类型
export interface PageProps {
  params: { [key: string]: string | string[] | undefined }
  searchParams: { [key: string]: string | string[] | undefined }
}

// 组件 Props 类型
export interface BaseComponentProps {
  className?: string
  children?: React.ReactNode
}

// 表单状态类型
export interface FormState<T = any> {
  data: T
  errors: Record<string, string>
  isSubmitting: boolean
  isValid: boolean
}

// 加载状态类型
export interface LoadingState {
  isLoading: boolean
  error: string | null
}

// 通用响应类型
export interface ApiResult<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
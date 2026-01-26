import { ReactNode } from 'react'

export type ValueType = 'text' | 'select' | 'date' | 'digit' | 'option'

export interface STableColumn<T = any> {
  /** 列标题 */
  title: string
  /** 数据字段键名 */
  dataIndex?: keyof T | string
  /** 唯一标识，默认为 dataIndex */
  key?: string
  /** 自定义渲染 */
  render?: (text: any, record: T, index: number) => ReactNode
  /** 列宽 */
  width?: number | string
  /** 自定义样式类名 */
  className?: string
  
  // --- 搜索相关配置 ---
  /** 是否在搜索表单中隐藏 */
  hideInSearch?: boolean
  /** 搜索表单中的字段类型 */
  valueType?: ValueType
  /** 搜索表单中的枚举值 (用于 select) */
  valueEnum?: Record<string, { text: string; status?: string }> | Map<string, { text: string; status?: string }>
  /** 搜索框占位符 */
  searchPlaceholder?: string
  /** 搜索字段的 key，如果不指定则使用 dataIndex */
  searchKey?: string

  // --- 表格展示相关 ---
  /** 是否在表格中隐藏 */
  hideInTable?: boolean
  /** 是否在移动端隐藏 */
  hideInMobile?: boolean
  /** 排序 */
  sorter?: boolean
}

export interface STablePaginationConfig {
  current: number
  pageSize: number
  total: number
}

export interface STableRequestParams {
  pageSize: number
  current: number
  [key: string]: any // 搜索参数
}

export interface STableResponse<T> {
  data: T[]
  total: number
  success?: boolean
}

export interface STableRowSelection<T> {
  /** 选中项的 key 数组 */
  selectedRowKeys: (string | number)[]
  /** 选中项发生变化时的回调 */
  onChange: (selectedRowKeys: (string | number)[], selectedRows: T[]) => void
}

export interface STableProps<T> {
  /** 列定义 */
  columns: STableColumn<T>[]
  /** 
   * 获取数据的请求方法
   * 接收分页参数和搜索参数，返回数据和总数
   */
  request: (params: STableRequestParams, sort?: Record<string, 'asc' | 'desc'>) => Promise<STableResponse<T>>
  /** 唯一键 */
  rowKey: string | ((record: T) => string)
  /** 表格标题 */
  headerTitle?: ReactNode
  /** 工具栏渲染 */
  toolBarRender?: () => ReactNode[]
  /** 
   * 移动端自定义渲染内容 
   * 如果不提供，默认使用 Card 布局展示非隐藏列
   */
  mobileRender?: (record: T, index: number) => ReactNode
  /** 默认分页大小 */
  defaultPageSize?: number
  /** 表格加载状态 */
  loading?: boolean
  /** 额外的样式类名 */
  className?: string
  /** 行选择配置 */
  rowSelection?: STableRowSelection<T>
}

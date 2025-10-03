// ============================================================================
// 爱心动画工具函数 - 性能优化版本
// ============================================================================

/**
 * 爱心动画配置接口
 */
export interface HeartAnimationConfig {
  /** 动画持续时间（毫秒） */
  duration: number
  /** 爱心大小范围 */
  sizeRange: [number, number]
  /** 移动距离范围 */
  moveRange: [number, number]
  /** 颜色数组 */
  colors: string[]
}

/**
 * 坐标点接口
 */
export interface Point {
  x: number
  y: number
}

/**
 * 爱心动画数据接口
 */
export interface HeartAnimationData {
  id: string
  startPosition: Point
  endPosition: Point
  size: number
  color: string
  duration: number
  delay: number
  onComplete?: (id: string) => void
}

/**
 * 点击事件类型枚举
 */
export enum ClickType {
  SINGLE = 'single',
  RAPID = 'rapid',
  LONG_PRESS = 'long_press'
}

/**
 * 点击事件数据接口
 */
export interface ClickEventData {
  type: ClickType
  position: Point
  timestamp: number
}

// ============================================================================
// 性能优化：对象池和缓存
// ============================================================================

/**
 * 简单的对象池实现，用于复用 Point 对象
 */
class PointPool {
  private pool: Point[] = []
  private maxSize = 50

  get(): Point {
    return this.pool.pop() || { x: 0, y: 0 }
  }

  release(point: Point): void {
    if (this.pool.length < this.maxSize) {
      point.x = 0
      point.y = 0
      this.pool.push(point)
    }
  }

  clear(): void {
    this.pool.length = 0
  }
}

// 全局对象池实例
const pointPool = new PointPool()

/**
 * 缓存计算结果的 Map
 */
const calculationCache = new Map<string, Point>()
const maxCacheSize = 100

/**
 * 清理缓存
 */
function clearCache(): void {
  if (calculationCache.size > maxCacheSize) {
    // 清理一半的缓存
    const entries = Array.from(calculationCache.entries())
    const toDelete = entries.slice(0, Math.floor(entries.length / 2))
    toDelete.forEach(([key]) => calculationCache.delete(key))
  }
}

// ============================================================================
// 坐标计算函数 - 优化版本
// ============================================================================

/**
 * 根据鼠标/触摸位置计算爱心起始坐标
 * @param event - 鼠标或触摸事件
 * @param container - 容器元素（可选，如果不提供则使用视口坐标）
 * @returns 相对于视口的坐标点
 */
export function getRelativePosition(event: MouseEvent | TouchEvent, container?: HTMLElement): Point {
  let clientX: number
  let clientY: number

  if ('touches' in event) {
    // 触摸事件 - 优先使用 touches，如果为空则使用 changedTouches
    const touch = event.touches.length > 0 ? event.touches[0] : event.changedTouches[0]
    if (touch) {
      clientX = touch.clientX
      clientY = touch.clientY
    } else {
      // 如果都没有触摸点，使用视口中心
      clientX = window.innerWidth / 2
      clientY = window.innerHeight / 2
    }
  } else if ('clientX' in event) {
    // 鼠标事件
    clientX = event.clientX
    clientY = event.clientY
  } else {
    // 默认中心位置
    clientX = window.innerWidth / 2
    clientY = window.innerHeight / 2
  }

  // 使用对象池获取 Point 对象
  const point = pointPool.get()

  if (container) {
    // 如果提供了容器，计算相对于容器的位置
    const rect = container.getBoundingClientRect()
    point.x = clientX - rect.left
    point.y = clientY - rect.top
  } else {
    // 否则使用视口坐标
    point.x = clientX
    point.y = clientY
  }

  return point
}

/**
 * 计算爱心动画的结束位置 - 优化版本
 * @param startPosition - 起始位置
 * @param moveRange - 移动距离范围 [min, max]
 * @returns 结束位置坐标
 */
export function calculateEndPosition(startPosition: Point, moveRange: [number, number]): Point {
  // 为了随机性，不使用缓存，每次都生成新的随机位置
  const [minMove, maxMove] = moveRange
  const distance = randomBetween(minMove, maxMove)

  // 随机角度向上飘动：角度范围从 -45度 到 -135度 (向上的扇形区域)
  // 转换为弧度：-π/4 到 -3π/4
  const minAngle = (-Math.PI * 3) / 4 // -135度
  const maxAngle = -Math.PI / 4 // -45度
  const angle = randomBetween(minAngle, maxAngle)

  const endPoint = pointPool.get()
  endPoint.x = startPosition.x + Math.cos(angle) * distance
  endPoint.y = startPosition.y + Math.sin(angle) * distance // sin为负值，所以向上移动

  return endPoint
}

// ============================================================================
// 事件判断函数 - 优化版本
// ============================================================================

/**
 * 快速点击检测器类 - 优化版本
 */
export class RapidClickDetector {
  private clickHistory: number[] = []
  private readonly rapidThreshold: number
  private readonly timeWindow: number
  private lastCleanupTime = 0
  private readonly cleanupInterval = 100 // 100ms 清理一次

  constructor(rapidThreshold = 3, timeWindow = 1000) {
    this.rapidThreshold = rapidThreshold
    this.timeWindow = timeWindow
  }

  /**
   * 记录点击并检测是否为快速点击 - 优化版本
   * @param timestamp - 点击时间戳
   * @returns 是否为快速点击
   */
  detectRapidClick(timestamp: number = Date.now()): boolean {
    // 优化：减少清理频率
    if (timestamp - this.lastCleanupTime > this.cleanupInterval) {
      this.clickHistory = this.clickHistory.filter((time) => timestamp - time <= this.timeWindow)
      this.lastCleanupTime = timestamp
    }

    // 添加当前点击
    this.clickHistory.push(timestamp)

    // 检测是否达到快速点击阈值
    return this.clickHistory.length >= this.rapidThreshold
  }

  /**
   * 重置点击历史
   */
  reset(): void {
    this.clickHistory.length = 0
    this.lastCleanupTime = 0
  }

  /**
   * 获取当前点击次数
   */
  getClickCount(): number {
    return this.clickHistory.length
  }
}

/**
 * 长按检测器类 - 优化版本
 */
export class LongPressDetector {
  private pressTimer: NodeJS.Timeout | null = null
  private readonly longPressThreshold: number

  constructor(longPressThreshold = 500) {
    this.longPressThreshold = longPressThreshold
  }

  /**
   * 开始长按检测
   * @param callback - 长按触发回调
   */
  startDetection(callback: () => void): void {
    this.clearDetection()
    this.pressTimer = setTimeout(callback, this.longPressThreshold)
  }

  /**
   * 清除长按检测
   */
  clearDetection(): void {
    if (this.pressTimer) {
      clearTimeout(this.pressTimer)
      this.pressTimer = null
    }
  }

  /**
   * 检查是否正在检测长按
   */
  isDetecting(): boolean {
    return this.pressTimer !== null
  }
}

// ============================================================================
// 随机化工具函数 - 优化版本
// ============================================================================

/**
 * 生成指定范围内的随机数 - 优化版本
 * @param min - 最小值
 * @param max - 最大值
 * @returns 随机数
 */
export function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * 从数组中随机选择一个元素 - 优化版本
 * @param array - 源数组
 * @returns 随机选择的元素
 */
export function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]!
}

// ============================================================================
// ID 生成优化
// ============================================================================

let idCounter = 0
const maxIdCounter = 999999

/**
 * 生成优化的唯一 ID
 */
function generateOptimizedId(): string {
  idCounter = (idCounter + 1) % maxIdCounter
  return `heart-${Date.now()}-${idCounter}`
}

/**
 * 生成随机的爱心动画数据 - 优化版本
 * @param startPosition - 起始位置
 * @param config - 动画配置
 * @returns 爱心动画数据
 */
export function generateHeartAnimationData(startPosition: Point, config: HeartAnimationConfig): HeartAnimationData {
  const id = generateOptimizedId()
  const endPosition = calculateEndPosition(startPosition, config.moveRange)
  const size = randomBetween(config.sizeRange[0], config.sizeRange[1])
  const color = randomChoice(config.colors)
  const delay = randomBetween(0, 100) // 随机延迟 0-100ms

  return {
    id,
    startPosition,
    endPosition,
    size,
    color,
    duration: config.duration,
    delay
  }
}

/**
 * 生成多个爱心动画数据 - 优化版本
 * @param startPosition - 起始位置
 * @param config - 动画配置
 * @param count - 爱心数量
 * @returns 爱心动画数据数组
 */
export function generateMultipleHearts(
  startPosition: Point,
  config: HeartAnimationConfig,
  count: number = 3
): HeartAnimationData[] {
  // 优化：预分配数组大小
  const hearts = new Array<HeartAnimationData>(count)

  for (let i = 0; i < count; i++) {
    hearts[i] = generateHeartAnimationData(startPosition, config)
  }

  return hearts
}

/**
 * 清理资源函数
 */
export function cleanup(): void {
  pointPool.clear()
  calculationCache.clear()
}

// ============================================================================
// 默认配置 - 优化版本
// ============================================================================

/**
 * 默认爱心动画配置 - 性能优化版本
 */
export const DEFAULT_HEART_CONFIG: HeartAnimationConfig = {
  duration: 1200, // 稍微减少动画时间以提升性能
  sizeRange: [36, 72], // 放大一倍的尺寸范围
  moveRange: [60, 300], // 增加移动范围以配合更大的尺寸
  colors: [
    '#ff69b4', // 热粉色
    '#ff1493', // 深粉色
    '#dc143c', // 深红色
    '#ff6347', // 番茄红
    '#ff4500' // 橙红色
  ]
}

/**
 * 快速点击默认配置
 */
export const DEFAULT_RAPID_CLICK_CONFIG = {
  threshold: 3, // 3次点击触发
  timeWindow: 1000 // 1秒时间窗口
}

/**
 * 长按默认配置
 */
export const DEFAULT_LONG_PRESS_CONFIG = {
  threshold: 500 // 500ms 长按阈值
}

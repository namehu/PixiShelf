import { AppState } from '@/types'

/**
 * 应用状态管理服务
 * 管理扫描状态、取消请求和进度消息
 */
class AppStateService {
  private state: AppState = {
    scanning: false,
    cancelRequested: false,
    lastProgressMessage: null
  }

  /**
   * 获取当前应用状态
   */
  getState(): AppState {
    return { ...this.state }
  }

  /**
   * 设置扫描状态
   */
  setScanning(scanning: boolean): void {
    this.state.scanning = scanning
    if (!scanning) {
      this.state.cancelRequested = false
      this.state.lastProgressMessage = null
    }
  }

  /**
   * 设置取消请求状态
   */
  setCancelRequested(cancelRequested: boolean): void {
    this.state.cancelRequested = cancelRequested
    if (cancelRequested) {
      this.state.lastProgressMessage = '正在取消…'
    }
  }

  /**
   * 设置进度消息
   */
  setProgressMessage(message: string | null): void {
    this.state.lastProgressMessage = message
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.state = {
      scanning: false,
      cancelRequested: false,
      lastProgressMessage: null
    }
  }
}

// 单例实例
let appStateServiceInstance: AppStateService | null = null

/**
 * 获取 AppStateService 实例
 */
export function getAppStateService(): AppStateService {
  if (!appStateServiceInstance) {
    appStateServiceInstance = new AppStateService()
  }
  return appStateServiceInstance
}

export { AppStateService }
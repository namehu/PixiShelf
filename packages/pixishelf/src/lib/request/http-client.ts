/**
 * HttpClient.ts
 *
 * 功能特性：
 * 1. 拦截器 (Request & Response)
 * 2. 自动超时处理 (Timeout)
 * 3. 真正中断请求 (Abort)
 * 4. 下载进度监控 (Download Progress)
 * 5. 完整的 TypeScript 类型支持
 * 6. 统一的错误处理 (HttpError)
 */

// ================= 1. 类型定义 =================

export interface DownloadProgressEvent {
  loaded: number
  total: number
  progress: number // 0 - 1 的小数
  bytes: number // 当前 chunk 的字节数
}

export interface RequestConfig extends RequestInit {
  baseURL?: string
  timeout?: number // 单位: ms
  params?: Record<string, string | number | boolean | null | undefined> // URL 查询参数
  onDownloadProgress?: (event: DownloadProgressEvent) => void
}

export interface InterceptorManager<V> {
  use(onFulfilled?: (value: V) => V | Promise<V>, onRejected?: (error: any) => any): number
  eject(id: number): void
}

// 内部使用的拦截器项结构
interface InterceptorItem<V> {
  onFulfilled?: (value: V) => V | Promise<V>
  onRejected?: (error: any) => any
}

// 扩展 Response 类型以包含配置信息和解析后的数据
export interface FetchResponse<T = any> extends Response {
  data: T // 自动解析后的数据
  config: RequestConfig
}

// ================= 2. 自定义错误类 (修复 ESLint 问题) =================

export class HttpError<T = any> extends Error {
  status: number
  statusText: string
  data: T
  config?: RequestConfig

  // oxlint-disable-next-line max-params
  constructor(message: string, status: number, statusText: string, data: T, config?: RequestConfig) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.statusText = statusText
    this.data = data
    this.config = config

    // 修复 TypeScript 编译为 ES5 时 instanceof 失效的问题
    Object.setPrototypeOf(this, HttpError.prototype)
  }
}

// ================= 3. 工具函数 =================

/**
 * 将 params 对象拼接到 URL 上
 */
function appendParams(url: string, params?: RequestConfig['params']): string {
  if (!params) return url
  const searchParams = new URLSearchParams()
  Object.keys(params).forEach((key) => {
    const value = params[key]
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value))
    }
  })
  const queryString = searchParams.toString()
  return queryString ? `${url}${url.includes('?') ? '&' : '?'}${queryString}` : url
}

/**
 * 监控 Response Body 的流读取进度
 * 返回一个新的 Response 对象，其 body 是被监控的新流
 */
function trackStreamProgress(response: Response, onProgress: (e: DownloadProgressEvent) => void): Response {
  const body = response.body
  if (!body) return response

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  let loaded = 0

  const stream = new ReadableStream({
    async start(controller) {
      const reader = body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          if (value) {
            loaded += value.byteLength
            onProgress({
              loaded,
              total,
              progress: total ? loaded / total : 0,
              bytes: value.byteLength
            })
            controller.enqueue(value)
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    }
  })

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText
  })
}

// ================= 4. 拦截器管理器实现 =================

class InterceptorManagerImpl<V> implements InterceptorManager<V> {
  private handlers: Array<InterceptorItem<V> | null> = []

  use(onFulfilled?: (value: V) => V | Promise<V>, onRejected?: (error: any) => any): number {
    this.handlers.push({ onFulfilled, onRejected })
    return this.handlers.length - 1
  }

  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null
    }
  }

  getAll() {
    return this.handlers.filter((h): h is InterceptorItem<V> => h !== null)
  }
}

// ================= 5. HttpClient 核心类 =================

export class HttpClient {
  public interceptors = {
    request: new InterceptorManagerImpl<RequestConfig>(),
    response: new InterceptorManagerImpl<FetchResponse>()
  }

  constructor(private defaults: RequestConfig = {}) {}

  /**
   * 核心请求方法
   */
  async request<T = any>(url: string, config: RequestConfig = {}): Promise<FetchResponse<T>> {
    // 1. 合并配置
    let mergedConfig: RequestConfig = { ...this.defaults, ...config }

    // 2. 处理 URL (BaseURL + Params)
    let finalUrl = mergedConfig.baseURL
      ? (mergedConfig.baseURL.endsWith('/') ? mergedConfig.baseURL : mergedConfig.baseURL + '/') +
        (url.startsWith('/') ? url.slice(1) : url)
      : url

    finalUrl = appendParams(finalUrl, mergedConfig.params)

    // 3. 执行请求拦截器链
    const requestInterceptors = this.interceptors.request.getAll()
    for (const interceptor of requestInterceptors) {
      if (interceptor.onFulfilled) {
        try {
          mergedConfig = await interceptor.onFulfilled(mergedConfig)
        } catch (error) {
          if (interceptor.onRejected) return Promise.reject(interceptor.onRejected(error))
          throw error
        }
      }
    }

    // 4. 配置 AbortController (用于超时和手动取消)
    const controller = new AbortController()
    let timeoutId: any = null

    if (mergedConfig.timeout) {
      timeoutId = setTimeout(() => controller.abort(), mergedConfig.timeout)
    }

    // 如果用户传入了 signal，我们需要监听它的 abort 事件来取消内部的 controller
    if (mergedConfig.signal) {
      mergedConfig.signal.addEventListener('abort', () => {
        controller.abort()
      })
    }

    // 将内部的 signal 赋值给 fetch 配置
    mergedConfig.signal = controller.signal

    try {
      // 5. 发起原生 Fetch 请求
      let response = await fetch(finalUrl, mergedConfig)

      // 清除超时定时器
      if (timeoutId) clearTimeout(timeoutId)

      // 6. 处理下载进度 (如果配置了 onDownloadProgress)
      if (mergedConfig.onDownloadProgress && response.body) {
        response = trackStreamProgress(response, mergedConfig.onDownloadProgress)
      }

      // 7. 预处理响应对象
      const fetchResponse = response as FetchResponse<T>
      fetchResponse.config = mergedConfig

      // 尝试解析 Body (默认 JSON，除非没有内容或类型不对)
      // 注意：这里解析会读取流，如果拦截器想要原始 blob/text，需要调整策略或在拦截器前不做解析
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          fetchResponse.data = await response.json()
        } catch {
          // JSON 解析失败，回退到 null 或根据需求处理
          fetchResponse.data = null as any
        }
      } else {
        // 非 JSON 类型，暂不解析，让用户通过 .text() 或 .blob() 自行获取，或者在此处扩展
        fetchResponse.data = null as any
      }

      // 8. 执行响应拦截器链
      const responseInterceptors = this.interceptors.response.getAll()
      for (const interceptor of responseInterceptors) {
        if (interceptor.onFulfilled) {
          try {
            // @ts-ignore: 允许拦截器返回任意值覆盖 response
            const result = await interceptor.onFulfilled(fetchResponse)
            if (result !== undefined) {
              // @ts-ignore
              return result
            }
          } catch (error) {
            if (interceptor.onRejected) return Promise.reject(interceptor.onRejected(error))
            throw error
          }
        }
      }

      // 9. 检查 HTTP 状态码 (Fetch 默认不会 reject 4xx/5xx)
      if (!response.ok) {
        throw new HttpError(
          `Request failed with status code ${response.status}`,
          response.status,
          response.statusText,
          fetchResponse.data,
          mergedConfig
        )
      }

      return fetchResponse
    } catch (error: any) {
      // 10. 统一错误处理 (包括网络错误、超时、拦截器抛出的错误、状态码错误)
      const responseInterceptors = this.interceptors.response.getAll()
      let rejectedPromise = Promise.reject<any>(error)

      // 触发响应拦截器的 onRejected
      for (const interceptor of responseInterceptors) {
        if (interceptor.onRejected) {
          rejectedPromise = rejectedPromise.catch(interceptor.onRejected)
        }
      }
      return rejectedPromise
    }
  }

  // === 快捷方法 ===

  get<T = any>(url: string, config?: RequestConfig) {
    return this.request<T>(url, { ...config, method: 'GET' })
  }

  post<T = any>(url: string, data?: any, config?: RequestConfig) {
    return this.request<T>(url, {
      ...config,
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
        ...config?.headers
      }
    })
  }

  put<T = any>(url: string, data?: any, config?: RequestConfig) {
    return this.request<T>(url, {
      ...config,
      method: 'PUT',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
        ...config?.headers
      }
    })
  }

  delete<T = any>(url: string, config?: RequestConfig) {
    return this.request<T>(url, { ...config, method: 'DELETE' })
  }
}

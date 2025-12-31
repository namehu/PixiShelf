import * as Admin from './data-contracts'
import instance from './instance'
import type { RequestConfig } from './http-client' // 假设 HttpClient 的类型定义导出

/**
 * 动态路径参数处理正则
 * 例如: /api/sysResource/{menu-id}/buttons -> 匹配 {menu-id}
 */
const DYNAMIC_PATH_REGEX = /\{([^{}]+)\}/g
const HYPHEN_REGEX = /-(\w)/g // 用于将 menu-id 转换为 menuId (驼峰)

/**
 * 创建 Proxy 处理逻辑
 */
const createHandler = (method: string) => {
  return new Proxy(
    {},
    {
      get: (_target, url: string) => {
        return async (args: any = {}) => {
          // 1. 提取 requestConfig (不作为请求参数发送)
          const { requestConfig, ...params } = args

          let finalUrl = url
          const finalParams = { ...params } // 浅拷贝，避免修改原对象

          // 2. 处理 URL 中的动态参数 (例如 {id})
          if (finalUrl.includes('{')) {
            finalUrl = finalUrl.replace(DYNAMIC_PATH_REGEX, (match, key) => {
              // 将 {menu-id} 转换为 menuId
              const paramKey = key.replace(HYPHEN_REGEX, (_: string, c: string) => c.toUpperCase())

              const value = finalParams[paramKey]

              // 校验必须参数
              if (value === undefined || value === null) {
                // oxlint-disable-next-line no-console
                console.warn(`[API Error] URL parameter '${paramKey}' is missing for ${url}`)
                return match
              }

              // 从发送的参数中移除该字段，因为它已经拼接到 URL 上了
              delete finalParams[paramKey]

              return String(value)
            })
          }

          // 3. 构造请求配置
          const config: RequestConfig = {
            url: finalUrl,
            method: method,
            ...requestConfig
          }

          // 4. 根据 method 分配参数位置
          // GET/DELETE 放在 params (Query String)
          // POST/PUT 放在 data (Body)
          if (method === 'GET' || method === 'DELETE') {
            config.params = finalParams
          } else {
            config.body = finalParams
          }

          // 5. 发起请求
          const response = await instance.request(finalUrl, config)
          return response
        }
      }
    }
  )
}

/**
 * 定义 API 结构
 * 对应 Admin.ts 中的四个接口定义
 */
interface API {
  get: Admin.APIGET
  post: Admin.APIPOST
  put: Admin.APIPUT
  del: Admin.APIDELETE
  options: Admin.APIOPTIONS
}

/**
 * 导出 api 对象
 * 使用方式: api.get['/url/path'](params)
 */
export const api = {
  get: createHandler('GET'),
  post: createHandler('POST'),
  put: createHandler('PUT'),
  del: createHandler('DELETE'),
  options: createHandler('OPTIONS')
} as unknown as API

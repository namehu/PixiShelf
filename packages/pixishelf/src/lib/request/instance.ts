import { toast } from 'sonner'
import { HttpClient, HttpError } from './http-client'

// 配置基础 URL
const instance = new HttpClient({ baseURL: '', timeout: 10000 })

// 请求拦截器
instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`
    }
  }
  return config
})

// 响应拦截器
instance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error instanceof HttpError) {
      toast.error(`接口报错 ${error.status}: ${error.data.msg || error.message}`)
    } else if (error.name === 'AbortError') {
      toast.warning('请求被取消或超时')
    } else {
      toast.error('网络错误:', error)
    }
    return Promise.reject(error)
  }
)

export default instance

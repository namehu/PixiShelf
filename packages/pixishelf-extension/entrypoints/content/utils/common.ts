import type { DownloadMessage, DownloadResponse } from '../../../types/messages'

/**
 * 等待指定毫秒数
 * @param ms 毫秒
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 触发文件下载
 * @param content 文件内容 (Blob 或 string)
 * @param filename 文件名
 * @param mimeType MIME 类型
 * @param customDirectory 自定义保存目录 (可选，需要后台脚本支持)
 */
export const downloadFile = async (
  content: string | Blob,
  filename: string,
  mimeType = 'text/plain;charset=utf-8',
  customDirectory?: string
) => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })

  if (customDirectory) {
    try {
      await new Promise<void>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const message: DownloadMessage = {
            type: 'DOWNLOAD_FILE',
            data: { dataUrl, filename, customDirectory }
          }
          chrome.runtime.sendMessage(message, (response: DownloadResponse) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
            else if (response.success) resolve()
            else reject(new Error(response.error || '下载失败'))
          })
        }
        reader.onerror = () => reject(new Error('无法读取 Blob'))
        reader.readAsDataURL(blob)
      })
      return
    } catch (error) {
      console.warn('Background script 下载失败，回退默认:', error)
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

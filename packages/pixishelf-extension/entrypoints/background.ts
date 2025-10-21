/**
 * Background Script - 处理downloads API和消息通信
 * 由于content script无法直接访问chrome.downloads API，
 * 需要通过background script来处理文件下载
 */

import type { DownloadMessage, DownloadResponse } from '../types/messages'

export default defineBackground(() => {
  // 监听来自content script的消息
  chrome.runtime.onMessage.addListener(
    (message: DownloadMessage, _sender, sendResponse: (response: DownloadResponse) => void) => {
      if (message.type === 'DOWNLOAD_FILE') {
        handleDownloadFile(message, sendResponse)
        return true // 保持消息通道开放以支持异步响应
      }
    }
  )

  /**
   * 处理文件下载请求
   */
  async function handleDownloadFile(message: DownloadMessage, sendResponse: (response: DownloadResponse) => void) {
    try {
      const { dataUrl, filename, customDirectory } = message.data
      // 2. (可选) 验证 dataUrl 是否有效
      if (!dataUrl || !dataUrl.startsWith('data:')) {
        throw new Error('无效的 data URL')
      }

      // 3. 构建下载路径
      let downloadPath = filename
      if (customDirectory) {
        const directory = customDirectory.endsWith('/') ? customDirectory : `${customDirectory}/`
        downloadPath = `${directory}${filename}`
      }

      // 使用chrome.downloads API下载文件
      const downloadId = await new Promise<number>((resolve, reject) => {
        chrome.downloads.download(
          {
            url: dataUrl,
            filename: downloadPath,
            conflictAction: 'uniquify', // 自动处理文件名冲突
            saveAs: false // 不显示保存对话框
          },
          (id) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message))
            } else if (id) {
              resolve(id)
            } else {
              reject(new Error('下载失败：未返回下载ID'))
            }
          }
        )
      })

      // 发送成功响应
      sendResponse({
        success: true,
        downloadId,
        message: `文件已下载到: ${downloadPath}`
      })

      console.log(`✅ Background: 文件下载成功 - ${downloadPath} (ID: ${downloadId})`)
    } catch (error) {
      // 发送错误响应
      const errorMessage = error instanceof Error ? error.message : '下载失败'
      sendResponse({
        success: false,
        error: errorMessage
      })

      console.error('❌ Background: 文件下载失败:', errorMessage)
    }
  }

  /**
   * 监听下载状态变化（可选，用于调试）
   */
  chrome.downloads.onChanged.addListener((downloadDelta) => {
    if (downloadDelta.state && downloadDelta.state.current === 'complete') {
      console.log(`✅ Background: 下载完成 - ID: ${downloadDelta.id}`)
    } else if (downloadDelta.state && downloadDelta.state.current === 'interrupted') {
      console.error(`❌ Background: 下载中断 - ID: ${downloadDelta.id}`)
    }
  })

  console.log('🚀 Background script 已启动')
})

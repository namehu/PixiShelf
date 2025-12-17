import React from 'react'
import { useUserInfoStore } from '../../stores/userInfoStore'
import { userInfoService } from '../../services/UserInfoService'
import { Button } from '@/components/ui/button'
import { MTagDownloadMode } from '@/enums/ETagDownloadMode'
import { useShallow } from 'zustand/shallow'
import { toast } from 'sonner'

export const UserController: React.FC = () => {
  const { userIdList, isRunning, addUserIds, getStats, clearAll, progressData, addLog } = useUserInfoStore(
    useShallow((state) => ({
      addLog: state.addLog,
      progressData: state.progressData,
      userIdList: state.userIdList,
      isRunning: state.isRunning,
      addUserIds: state.addUserIds,
      getStats: state.getStats,
      clearAll: state.clearAll
    }))
  )

  const failedUsers = React.useMemo(() => {
    return Object.entries(progressData)
      .filter(([_, progress]) => progress.status === 'rejected')
      .map(([userId, progress]) => ({
        userId,
        error: typeof progress.data === 'string' ? progress.data : '未知错误'
      }))
  }, [progressData])

  const [userInput, setUserInput] = React.useState('')
  const [downloadProgress, setDownloadProgress] = React.useState({
    current: 0,
    total: 0,
    isDownloading: false
  })

  const handleStartTask = async () => {
    try {
      addLog('开始抓取用户信息任务...')
      await userInfoService.processUsers(userIdList)
      addLog('用户信息抓取完成')
    } catch (error) {
      addLog(`任务执行失败: ${error}`)
    }
  }

  const handleGenerateSQL = async () => {
    try {
      const result = await userInfoService.downloadUserSqlFile()
      if (result.success) {
        addLog('用户SQL文件下载成功')
      } else {
        addLog(`SQL下载失败: ${result.error}`)
      }
    } catch (error) {
      addLog(`SQL下载失败: ${error}`)
    }
  }

  const handleDownloadImages = async () => {
    try {
      setDownloadProgress({ current: 0, total: 0, isDownloading: true })
      addLog(`开始下载用户图片...`)

      const result = await userInfoService.downloadUserImages({
        images: [], // 空数组，方法内部会自动收集图片
        onProgress: (current, total) => {
          setDownloadProgress({ current, total, isDownloading: true })
          addLog(`图片下载进度: ${current}/${total}`)
        }
      })

      if (result.success) {
        addLog(`用户图片下载完成`)
      } else {
        addLog(`图片下载失败: ${result.error}`)
      }
    } catch (error) {
      addLog(`图片下载失败: ${error}`)
    } finally {
      setDownloadProgress({ current: 0, total: 0, isDownloading: false })
    }
  }

  const handleAddUserIds = () => {
    const ids = userInput.trim()
    if (!ids.length) {
      toast.warning('请输入有效的用户ID')
      return
    }
    const result = addUserIds(ids)
    addLog(`添加成功: ${result.added}个用户, 共${result.total}个用户, 重复${result.duplicates}个`)
    setUserInput('')
  }

  const handleClear = async () => {
    if (!confirm('确定要清除所有用户数据吗？此操作不可恢复。')) return
    clearAll()
    addLog('用户数据已清除')
  }

  const handleFilterFailed = () => {
    // 从失败的用户中移除
    failedUsers.forEach(({ userId }) => {
      useUserInfoStore.getState().removeUserId(userId)
    })
    addLog('已过滤失败的用户数据')
  }

  const stats = getStats()

  return (
    <div className="user-controller">
      <div className="input-section" style={{ marginBottom: '12px' }}>
        <textarea
          id="user-input"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="添加用户ID或用户链接(每行一个),例如:&#10;123456&#10;..."
          rows={4}
          className="w-full p-2 border border-gray-300 rounded text-sm font-sans resize-y min-h-20"
        />
      </div>

      {/* 任务控制 */}
      <div className="control-section" style={{ marginBottom: '12px' }}>
        <Button
          variant={!userInput ? 'secondary' : 'default'}
          disabled={!userInput}
          style={{ margin: '4px' }}
          onClick={handleAddUserIds}
        >
          添加用户
        </Button>

        <Button
          variant={isRunning ? 'secondary' : 'default'}
          disabled={isRunning || userIdList.length === 0}
          style={{ margin: '4px' }}
          onClick={handleStartTask}
        >
          {isRunning ? '运行中...' : '开始抓取'}
        </Button>

        <Button variant="outline" onClick={handleGenerateSQL} disabled={isRunning} style={{ margin: '4px' }}>
          生成SQL
        </Button>

        <Button
          onClick={handleDownloadImages}
          variant="outline"
          disabled={downloadProgress.isDownloading || stats.successful === 0}
          style={{ margin: '4px' }}
        >
          {downloadProgress.isDownloading
            ? `下载中 ${downloadProgress.current}/${downloadProgress.total}`
            : `下载用户图片`}
        </Button>

        <Button
          variant="outline"
          onClick={handleFilterFailed}
          disabled={isRunning || stats.failed === 0}
          style={{ margin: '4px' }}
        >
          过滤失败
        </Button>

        <Button variant="destructive" onClick={handleClear} disabled={isRunning} style={{ margin: '4px' }}>
          清除所有数据
        </Button>
      </div>
    </div>
  )
}

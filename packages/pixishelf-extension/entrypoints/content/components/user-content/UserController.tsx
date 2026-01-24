import React from 'react'
import { useUserInfoStore } from '../../stores/userInfoStore'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useUserCrawler } from '../../hooks/useUserCrawler'
import { useLogger } from '../../hooks/useLogger'
import { db, UserItem } from '../../services/db'
import { useLiveQuery } from 'dexie-react-hooks'

export const UserController: React.FC = () => {
  const { userInput, setUserInput, isRunning, downloadProgress } = useUserInfoStore()

  const { startTask, downloadUserSqlFile, downloadUserImages } = useUserCrawler()
  const { success, warn, error: logError } = useLogger('artist')

  // Live query for failed users to filter
  const failedUsersCount = useLiveQuery(() => db.users.where('status').equals('rejected').count()) || 0
  const hasSuccessfulUsers = useLiveQuery(() => db.users.where('status').equals('fulfilled').count()) || 0
  const hasUsers = useLiveQuery(() => db.users.count()) || 0

  const handleStartTask = async () => {
    try {
      const pendingCount = await db.users.where('status').equals('pending').count()
      if (pendingCount === 0) {
        return warn('没有待处理的用户')
      }
      await startTask()
    } catch (error) {
      logError(`任务执行失败: ${error}`)
    }
  }

  const handleGenerateSQL = async () => {
    await downloadUserSqlFile()
  }

  const handleDownloadImages = async () => {
    if (hasSuccessfulUsers === 0) {
      warn('没有成功的用户数据可下载图片')
      return
    }
    await downloadUserImages()
  }

  const handleAddUserIds = async () => {
    const ids = userInput.trim()
    if (!ids.length) {
      toast.warning('请输入有效的用户ID')
      return
    }

    const userIds = ids
      .split('\n')
      .map((id) => id.trim())
      .filter(Boolean)

    try {
      const uniqueInputIds = [...new Set(userIds)]
      const existingItems = await db.users.bulkGet(uniqueInputIds)

      const itemsToAdd: UserItem[] = uniqueInputIds
        .filter((_, index) => existingItems[index] === undefined)
        .map((uid) => ({
          uid,
          status: 'pending',
          updatedAt: Date.now()
        }))

      if (itemsToAdd.length > 0) {
        await db.users.bulkAdd(itemsToAdd)
      }

      const added = itemsToAdd.length
      const duplicates = userIds.length - added

      if (added === 0) {
        warn('没有添加任何新用户')
      } else {
        success(`添加成功: ${added}个用户` + (duplicates > 0 ? `, 重复${duplicates}个` : ''))
        setUserInput('')
      }
    } catch (err: any) {
      logError(`添加用户失败: ${err.message}`)
    }
  }

  const handleClear = async () => {
    if (!confirm('确定要清除所有用户数据吗？此操作不可恢复。')) return
    try {
      await db.users.clear()
      warn('用户数据已清除')
    } catch (e) {
      logError(`清除失败: ${e}`)
    }
  }

  const handleFilterFailed = async () => {
    try {
      // Find all rejected users and delete them
      const failedKeys = await db.users.where('status').equals('rejected').primaryKeys()
      await db.users.bulkDelete(failedKeys)
      warn(`已移除 ${failedKeys.length} 个失败的用户数据`)
    } catch (e) {
      logError(`过滤失败: ${e}`)
    }
  }

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
          disabled={isRunning || hasUsers === 0}
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
          disabled={downloadProgress.isDownloading || hasSuccessfulUsers === 0}
          style={{ margin: '4px' }}
        >
          {downloadProgress.isDownloading
            ? `下载中 ${downloadProgress.current}/${downloadProgress.total}`
            : `下载用户图片`}
        </Button>

        <Button
          variant="outline"
          onClick={handleFilterFailed}
          disabled={isRunning || failedUsersCount === 0}
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

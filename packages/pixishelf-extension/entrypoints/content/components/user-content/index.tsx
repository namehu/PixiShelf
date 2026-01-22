import { UserController } from './UserController'

import { useUserInfoStore } from '../../stores/userInfoStore'
import { useShallow } from 'zustand/shallow'
import { BaseLogViewer } from '../BaseLogViewer'
import { BaseProgressDisplay } from '../BaseProgressDisplay'

export default function UserContent() {
  const [logs, clearLogs] = useUserInfoStore(useShallow((state) => [state.logs, state.clearLogs]))
  const { getStats } = useUserInfoStore()
  const taskStats = getStats()

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-bold text-2xl">用户信息管理</h1>

      <UserController />

      <BaseProgressDisplay stats={taskStats} />

      <BaseLogViewer logs={logs} onClear={clearLogs} />
    </div>
  )
}

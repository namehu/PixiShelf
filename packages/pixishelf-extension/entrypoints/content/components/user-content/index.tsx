import { UserController } from './UserController'
import { UserProgressDisplay } from './UserProgressDisplay'

import { useUserInfoStore } from '../../stores/userInfoStore'
import { useShallow } from 'zustand/shallow'
import { BaseLogViewer } from '../BaseLogViewer'

export default function UserContent() {
  const [logs, clearLogs] = useUserInfoStore(useShallow((state) => [state.logs, state.clearLogs]))

  return (
    <div className="users-content">
      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#333' }}>用户信息管理</h3>

      {/* 用户控制器 */}
      <div style={{ marginBottom: '16px' }}>
        <UserController />
      </div>

      {/* 进度显示 */}
      <div style={{ marginBottom: '16px' }}>
        <UserProgressDisplay />
      </div>

      {/* 日志查看器 */}
      <div style={{ marginBottom: '16px' }}>
        <BaseLogViewer logs={logs} onClear={clearLogs} />
      </div>
    </div>
  )
}

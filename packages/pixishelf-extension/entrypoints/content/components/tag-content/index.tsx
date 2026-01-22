import { BaseLogViewer } from '../BaseLogViewer'
import { useTaskStore } from '../../stores/taskStore'
import { ProgressDisplay } from './ProgressDisplay'
import { TaskController } from './TaskController'

export default function TagTaskContent() {
  const { logs, clearLogs } = useTaskStore()

  return (
    <div className="users-content">
      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#333' }}>标签信息管理</h3>

      {/* 用户控制器 */}
      <div style={{ marginBottom: '16px' }}>
        <TaskController />
      </div>

      {/* 进度显示 */}
      <div style={{ marginBottom: '16px' }}>
        <ProgressDisplay />
      </div>

      {/* 日志查看器 */}
      <div style={{ marginBottom: '16px' }}>
        <BaseLogViewer logs={logs} onClear={clearLogs} />
      </div>
    </div>
  )
}

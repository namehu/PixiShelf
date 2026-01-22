import { BaseLogViewer } from '../BaseLogViewer'
import { useTaskStore } from '../../stores/taskStore'
import { TaskController } from './TaskController'
import { BaseProgressDisplay } from '../BaseProgressDisplay'

export default function TagTaskContent() {
  const { logs, clearLogs, taskStats } = useTaskStore()

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-bold text-2xl">标签信息管理</h1>

      <TaskController />

      <BaseProgressDisplay stats={taskStats} />

      <BaseLogViewer logs={logs} onClear={clearLogs} />
    </div>
  )
}

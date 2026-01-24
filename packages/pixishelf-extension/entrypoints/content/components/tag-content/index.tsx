import { BaseLogViewer } from '../BaseLogViewer'
import { TaskController } from './TaskController'
import { BaseProgressDisplay } from '../BaseProgressDisplay'
import { useLogger } from '../../hooks/useLogger'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../services/db'

export default function TagTaskContent() {
  const { logs, clear } = useLogger('tag')

  const taskStats = useLiveQuery(async () => {
    return {
      total: await db.tags.count(),
      completed:
        (await db.tags.where('status').equals('fulfilled').count()) +
        (await db.tags.where('status').equals('rejected').count()),
      successful: await db.tags.where('status').equals('fulfilled').count(),
      failed: await db.tags.where('status').equals('rejected').count(),
      pending:
        (await db.tags.where('status').equals('pending').count()) +
        (await db.tags.where('status').equals('running').count())
    }
  }, []) || { total: 0, completed: 0, successful: 0, failed: 0, pending: 0 }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-bold text-2xl">标签信息管理</h1>

      <TaskController />

      <BaseProgressDisplay stats={taskStats} />

      <BaseLogViewer logs={logs} onClear={clear} />
    </div>
  )
}

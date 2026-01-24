import { UserController } from './UserController'
import { BaseLogViewer } from '../BaseLogViewer'
import { BaseProgressDisplay } from '../BaseProgressDisplay'
import { useLogger } from '../../hooks/useLogger'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../services/db'

export default function UserContent() {
  const { logs, clear } = useLogger('artist')

  const userStats = useLiveQuery(async () => {
    return {
      total: await db.users.count(),
      completed:
        (await db.users.where('status').equals('fulfilled').count()) +
        (await db.users.where('status').equals('rejected').count()),
      successful: await db.users.where('status').equals('fulfilled').count(),
      failed: await db.users.where('status').equals('rejected').count(),
      pending:
        (await db.users.where('status').equals('pending').count()) +
        (await db.users.where('status').equals('running').count())
    }
  }, []) || { total: 0, completed: 0, successful: 0, failed: 0, pending: 0 }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-bold text-2xl">用户信息管理</h1>

      <UserController />

      <BaseProgressDisplay stats={userStats} />

      <BaseLogViewer logs={logs} onClear={clear} />
    </div>
  )
}

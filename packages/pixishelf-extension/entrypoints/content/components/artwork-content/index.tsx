import { ArtworkTaskController } from './ArtworkTaskController'
import { BaseLogViewer } from '../BaseLogViewer'
import { useArtworkTaskStore } from '../../stores/artworkTaskStore'
import { BaseProgressDisplay } from '../BaseProgressDisplay'

export default function ArtworkContent() {
  const { logs, clearLogs, taskStats } = useArtworkTaskStore()

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-bold text-2xl">作品信息管理</h3>

      <ArtworkTaskController />

      <BaseProgressDisplay stats={taskStats} />

      <BaseLogViewer logs={logs} onClear={clearLogs} />
    </div>
  )
}

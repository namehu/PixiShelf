import { ArtworkTaskController } from './ArtworkTaskController'
import { ArtworkProgressDisplay } from './ArtworkProgressDisplay'

import { BaseLogViewer } from '../BaseLogViewer'
import { useArtworkTaskStore } from '../../stores/artworkTaskStore'

export default function ArtworkContent() {
  const { logs, clearLogs } = useArtworkTaskStore()

  return (
    <div className="artworks-content">
      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#333' }}>作品信息管理</h3>

      <div style={{ marginBottom: '16px' }}>
        <ArtworkTaskController />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <ArtworkProgressDisplay />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <BaseLogViewer logs={logs} onClear={clearLogs} />
      </div>
    </div>
  )
}


import React from 'react'
import { useArtworkTaskStore } from '../stores/artworkTaskStore'
import { Progress } from '@/components/ui/progress'

export const ArtworkProgressDisplay: React.FC = () => {
  const { taskStats } = useArtworkTaskStore()

  const statItemStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '4px 2px',
    backgroundColor: '#f8f9fa',
    borderRadius: '3px',
    textAlign: 'center' as const,
    minWidth: '0'
  }

  const statLabelStyle = {
    fontWeight: '500',
    color: '#666',
    fontSize: '10px',
    marginBottom: '2px',
    whiteSpace: 'nowrap' as const
  }

  const statValueStyle = {
    fontWeight: '600',
    fontSize: '14px'
  }

  const successStyle = {
    ...statValueStyle,
    color: '#28a745'
  }

  const errorStyle = {
    ...statValueStyle,
    color: '#dc3545'
  }

  const pendingStyle = {
    ...statValueStyle,
    color: '#ffc107'
  }

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '4px',
    marginBottom: '6px'
  }

  return (
    <div className="progress-display" style={{ marginBottom: '8px' }}>
      {/* 进度统计 - 一行网格布局 */}
      <div className="stats-grid" style={statsGridStyle}>
        <div style={statItemStyle}>
          <span style={statLabelStyle}>总计</span>
          <span style={statValueStyle}>{taskStats.total}</span>
        </div>

        <div style={statItemStyle}>
          <span style={statLabelStyle}>已完成</span>
          <span style={statValueStyle}>{taskStats.completed}</span>
        </div>

        <div style={statItemStyle}>
          <span style={statLabelStyle}>成功</span>
          <span style={successStyle}>{taskStats.successful}</span>
        </div>

        <div style={statItemStyle}>
          <span style={statLabelStyle}>失败</span>
          <span style={errorStyle}>{taskStats.failed}</span>
        </div>

        <div style={statItemStyle}>
          <span style={statLabelStyle}>待处理</span>
          <span style={pendingStyle}>{taskStats.pending}</span>
        </div>
      </div>

      {/* 进度条 - 独占一行 */}
      {taskStats.total > 0 && (
        <div style={{ marginTop: '6px' }}>
          <Progress value={(taskStats.completed / taskStats.total) * 100} className="w-full" />
          <div
            style={{
              marginTop: '2px',
              fontSize: '10px',
              color: '#666',
              textAlign: 'center'
            }}
          >
            {Math.round((taskStats.completed / taskStats.total) * 100)}% 完成
          </div>
        </div>
      )}
    </div>
  )
}

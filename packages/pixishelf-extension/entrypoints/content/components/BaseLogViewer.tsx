import React, { useEffect, useRef } from 'react'

interface BaseLogViewerProps {
  logs: string[]
  onClear: () => void
  title?: string
  height?: string
}

export const BaseLogViewer: React.FC<BaseLogViewerProps> = ({
  logs,
  onClear,
  title = '运行日志',
  height = '200px'
}) => {
  const logsEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到最新日志
  // useEffect(() => {
  //   logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  // }, [logs])

  return (
    <div className="log-viewer">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px'
        }}
      >
        <h4 style={{ margin: 0, fontSize: '16px', color: '#333' }}>{title}</h4>
        {logs.length > 0 && (
          <button
            onClick={onClear}
            style={{
              padding: '4px 8px',
              fontSize: '12px',
              backgroundColor: '#f0f0f0',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: '#666'
            }}
          >
            清除日志
          </button>
        )}
      </div>

      <div
        className="logs-container"
        style={{
          height: height,
          overflowY: 'auto',
          border: '1px solid #e0e0e0',
          borderRadius: '4px',
          backgroundColor: '#f8f9fa',
          padding: '8px'
        }}
      >
        {logs.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999',
              fontSize: '14px'
            }}
          >
            暂无日志
          </div>
        ) : (
          <>
            {logs.map((log, index) => (
              <div
                key={index}
                className="log-item"
                style={{
                  padding: '4px 0',
                  fontSize: '12px',
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  color: '#333',
                  borderBottom: index < logs.length - 1 ? '1px solid #eee' : 'none',
                  wordBreak: 'break-word'
                }}
              >
                {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </>
        )}
      </div>
    </div>
  )
}

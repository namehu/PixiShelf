import React, { useState, memo } from 'react'
import { LogEntry } from '../stores/logStore'
import { Virtuoso } from 'react-virtuoso'
import Ansi from 'ansi-to-react'

interface BaseLogViewerProps {
  logs: string[] | LogEntry[]
  onClear: () => void
  title?: string
  height?: string
}

// Map levels to background colors for better visibility
const LEVEL_STYLES: Record<string, React.CSSProperties> = {
  error: { backgroundColor: '#ffebee', color: '#c62828' }, // Light red bg, darker red text
  warn: { backgroundColor: '#fff3e0', color: '#ef6c00' }, // Light orange bg, dark orange text
  success: { backgroundColor: '#e8f5e9', color: '#2e7d32' }, // Light green bg, dark green text
  info: {}
}

const LogItem = memo(({ index, log }: { index: number; log: string | LogEntry }) => {
  const isString = typeof log === 'string'
  const message = isString ? log : log.message
  const level = isString ? 'info' : log.level || 'info'

  const style = {
    padding: '2px 8px',
    fontSize: '12px',
    lineHeight: '1.6',
    fontFamily: 'Menlo, Monaco, Consolas, monospace',
    borderBottom: '1px solid #fafafa',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    ...LEVEL_STYLES[level]
  } as React.CSSProperties

  return (
    <div style={style}>
      <span style={{ color: '#999', marginRight: '8px', userSelect: 'none' }}>[{index + 1}]</span>
      {/* Parse ANSI color codes */}
      <Ansi>{message}</Ansi>
    </div>
  )
})

LogItem.displayName = 'LogItem'

export const BaseLogViewer: React.FC<BaseLogViewerProps> = ({
  logs,
  onClear,
  title = '运行日志',
  height = '200px'
}) => {
  const [autoScroll, setAutoScroll] = useState(true)

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '12px',
              cursor: 'pointer',
              userSelect: 'none',
              color: '#666'
            }}
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              style={{ marginRight: '4px' }}
            />
            锁定滚动
          </label>
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
      </div>

      <div
        className="logs-container"
        style={{
          height: height,
          border: '1px solid #e0e0e0',
          borderRadius: '4px',
          backgroundColor: '#f8f9fa',
          overflow: 'hidden' // Virtuoso handles overflow
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
          <Virtuoso<string | LogEntry>
            data={logs as (string | LogEntry)[]}
            followOutput={autoScroll ? 'smooth' : false}
            initialTopMostItemIndex={logs.length - 1}
            itemContent={(index, log) => <LogItem index={index} log={log} />}
          />
        )}
      </div>
    </div>
  )
}

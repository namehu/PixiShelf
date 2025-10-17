import React from 'react';
import { useTaskStore } from '../stores/taskStore';

export const ProgressDisplay: React.FC = () => {
  const { taskStats } = useTaskStore();

  const statItemStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: '#f8f9fa',
    borderRadius: '4px',
    margin: '4px 0'
  };

  const statLabelStyle = {
    fontWeight: '500',
    color: '#666'
  };

  const statValueStyle = {
    fontWeight: '600',
    fontSize: '16px'
  };

  const successStyle = {
    ...statValueStyle,
    color: '#28a745'
  };

  const errorStyle = {
    ...statValueStyle,
    color: '#dc3545'
  };

  const pendingStyle = {
    ...statValueStyle,
    color: '#ffc107'
  };

  return (
    <div className="progress-display" style={{ marginBottom: '16px' }}>
      <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#333' }}>
        进度统计
      </h4>
      
      {/* 进度统计 */}
      <div className="stats-grid">
        <div style={statItemStyle}>
          <span style={statLabelStyle}>总计:</span>
          <span style={statValueStyle}>{taskStats.total}</span>
        </div>
        
        <div style={statItemStyle}>
          <span style={statLabelStyle}>已完成:</span>
          <span style={statValueStyle}>{taskStats.completed}</span>
        </div>
        
        <div style={statItemStyle}>
          <span style={statLabelStyle}>成功:</span>
          <span style={successStyle}>{taskStats.successful}</span>
        </div>
        
        <div style={statItemStyle}>
          <span style={statLabelStyle}>失败:</span>
          <span style={errorStyle}>{taskStats.failed}</span>
        </div>
        
        <div style={statItemStyle}>
          <span style={statLabelStyle}>待处理:</span>
          <span style={pendingStyle}>{taskStats.pending}</span>
        </div>
      </div>

      {/* 进度条 */}
      {taskStats.total > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{
            width: '100%',
            height: '8px',
            backgroundColor: '#e9ecef',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${(taskStats.completed / taskStats.total) * 100}%`,
              height: '100%',
              backgroundColor: '#0066cc',
              transition: 'width 0.3s ease'
            }} />
          </div>
          <div style={{
            marginTop: '4px',
            fontSize: '12px',
            color: '#666',
            textAlign: 'center'
          }}>
            {Math.round((taskStats.completed / taskStats.total) * 100)}% 完成
          </div>
        </div>
      )}
    </div>
  );
};
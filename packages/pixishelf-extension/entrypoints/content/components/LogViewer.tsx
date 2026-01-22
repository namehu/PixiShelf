import React from 'react';
import { useTaskStore } from '../stores/taskStore';
import { BaseLogViewer } from './BaseLogViewer';

export const LogViewer: React.FC = () => {
  const { logs, clearLogs } = useTaskStore();

  return <BaseLogViewer logs={logs} onClear={clearLogs} />;
};

// UI相关类型定义

// 面板位置
export interface PanelPosition {
  x: number;
  y: number;
}

// 标签页类型
export type TabType = 'tags' | 'users' | 'artworks';

// 日志级别
export type LogLevel = 'info' | 'success' | 'warning' | 'error';

// 日志条目
export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  details?: any;
}

// UI状态
export interface UIState {
  isVisible: boolean;
  isCollapsed: boolean;
  position: PanelPosition;
  activeTab: TabType;
}

// 任务状态
export interface TaskState {
  isRunning: boolean;
  isPaused: boolean;
  stats: {
    total: number;
    completed: number;
    successful: number;
    failed: number;
    pending: number;
  };
  downloadProgress: {
    current: number;
    total: number;
    isDownloading: boolean;
  };
  logs: LogEntry[];
  tagInput: string;
}

// 应用状态
export interface AppState {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
}

// 存储键名
export const STORAGE_KEYS = {
  PANEL_POSITION: 'pixiv_extension_panel_position',
  PANEL_VISIBILITY: 'pixiv_extension_panel_visibility',
  PANEL_COLLAPSED: 'pixiv_extension_panel_collapsed',
  ACTIVE_TAB: 'pixiv_extension_active_tab',
  TASK_PROGRESS: 'pixiv_extension_task_progress',
  TAG_LIST: 'pixiv_extension_tag_list',
  TASK_STATS: 'pixiv_extension_task_stats',
} as const;

// 默认配置
export const DEFAULT_CONFIG = {
  PANEL_POSITION: { x: 20, y: 100 },
  PANEL_SIZE: { width: 400, height: 600 },
  ANIMATION_DURATION: 300,
  AUTO_SAVE_INTERVAL: 1000,
} as const;
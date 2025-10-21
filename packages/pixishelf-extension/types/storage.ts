// 存储相关类型定义

import { TaskProgress, TaskStats } from './pixiv';
import { PanelPosition, TabType } from './ui';

// Chrome Storage 数据结构
export interface StorageData {
  // 任务相关
  [key: `task_progress_${string}`]: TaskProgress;
  task_stats: TaskStats;
  tag_list: string[];
  
  // UI状态
  panel_position: PanelPosition;
  panel_visibility: boolean;
  panel_collapsed: boolean;
  active_tab: TabType;
  
  // 应用设置
  app_settings: AppSettings;
}

// 应用设置
export interface AppSettings {
  autoSave: boolean;
  animationEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxLogEntries: number;
  downloadTimeout: number;
  retryAttempts: number;
}

// 存储操作结果
export interface StorageResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// 批量存储操作
export interface BatchStorageOperation {
  key: string;
  value: any;
  action: 'set' | 'remove';
}

// 存储事件
export interface StorageChangeEvent {
  key: string;
  oldValue?: any;
  newValue?: any;
  area: 'local' | 'sync' | 'managed';
}

// 存储管理器接口
export interface IStorageManager {
  // 基础操作
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  clear(): Promise<boolean>;
  
  // 批量操作
  getMultiple<T>(keys: string[]): Promise<Record<string, T>>;
  setMultiple(items: Record<string, any>): Promise<boolean>;
  removeMultiple(keys: string[]): Promise<boolean>;
  
  // 专用方法
  getTagList(): Promise<string[]>;
  setTagList(tags: string[]): Promise<boolean>;
  addTag(tag: string): Promise<boolean>;
  removeTag(tag: string): Promise<boolean>;
  
  getTaskProgress(tag: string): Promise<TaskProgress | null>;
  setTaskProgress(tag: string, progress: TaskProgress): Promise<boolean>;
  removeTaskProgress(tag: string): Promise<boolean>;
  clearTaskProgress(): Promise<boolean>;
  
  getTaskStats(): Promise<TaskStats | null>;
  setTaskStats(stats: TaskStats): Promise<boolean>;
  
  // 事件监听
  onChanged(callback: (changes: StorageChangeEvent[]) => void): void;
  offChanged(callback: (changes: StorageChangeEvent[]) => void): void;
}

// 默认设置
export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoSave: true,
  animationEnabled: true,
  logLevel: 'info',
  maxLogEntries: 1000,
  downloadTimeout: 30000,
  retryAttempts: 3,
};

// 存储键前缀
export const STORAGE_PREFIXES = {
  TASK_PROGRESS: 'task_progress_',
  UI_STATE: 'ui_state_',
  APP_SETTING: 'app_setting_',
} as const;
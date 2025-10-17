// 统一类型导出

// 基础类型
export * from './pixiv';
export * from './messages';

// UI相关类型
export * from './ui';

// 存储相关类型
export * from './storage';

// 服务相关类型
export * from './service';

// 常用类型别名
export type { 
  PixivTagData,
  TaskProgress,
  TaskStats,
  ProgressStorage,
} from './pixiv';

export type {
  ImageDownloadData,
  ImageDownloadResult,
  ExtensionMessage,
  ExtensionResponse,
} from './messages';

export type {
  PanelPosition,
  TabType,
  LogLevel,
  LogEntry,
  UIState,
  TaskState,
  AppState,
} from './ui';

export type {
  StorageData,
  AppSettings,
  StorageResult,
  IStorageManager,
} from './storage';

export type {
  ServiceResult,
  TaskExecutionState,
  TaskConfiguration,
  TranslationRequest,
  TranslationResponse,
  IPixivService,
} from './service';
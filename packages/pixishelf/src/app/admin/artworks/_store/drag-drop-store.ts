import { create } from 'zustand'

/**
 * 拖拽上传状态管理 Store
 * 用于在 ImageManagerDialog（拖拽源）和 ImageReplaceDialog（上传执行者）之间共享状态和文件数据
 */
export interface DragDropState {
  /** 是否正在拖拽文件经过目标区域 */
  isDragging: boolean
  /** 等待上传的文件队列 */
  fileQueue: File[]
  /** 当前上传所处的阶段 */
  uploadPhase: 'idle' | 'uploading' | 'success' | 'error'

  // --- Actions ---

  /** 设置拖拽状态 */
  setDragging: (isDragging: boolean) => void
  /** 添加文件到待上传队列 */
  addFilesToQueue: (files: File[]) => void
  /** 重置文件队列和上传状态 */
  resetQueue: () => void
  /** 设置当前上传阶段 */
  setUploadPhase: (phase: 'idle' | 'uploading' | 'success' | 'error') => void
}

export const useDragDropStore = create<DragDropState>((set) => ({
  // 初始状态
  isDragging: false,
  fileQueue: [],
  uploadPhase: 'idle',

  // Actions 实现
  setDragging: (isDragging) => set({ isDragging }),
  addFilesToQueue: (files) => set((state) => ({ fileQueue: [...state.fileQueue, ...files] })),
  resetQueue: () => set({ fileQueue: [], uploadPhase: 'idle' }),
  setUploadPhase: (uploadPhase) => set({ uploadPhase })
}))

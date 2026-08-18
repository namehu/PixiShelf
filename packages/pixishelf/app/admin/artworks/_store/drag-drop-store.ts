import { create } from 'zustand'

/**
 * 拖拽上传文件队列 Store
 * 用于在拖拽目标和 ImageReplaceDialog（上传执行者）之间共享文件数据
 */
export interface DragDropState {
  /** 等待上传的文件队列 */
  fileQueue: File[]
  /** 当前上传所处的阶段 */
  uploadPhase: 'idle' | 'uploading' | 'success' | 'error'

  // --- Actions ---

  /** 添加文件到待上传队列 */
  addFilesToQueue: (files: File[]) => void
  /** 重置文件队列和上传状态 */
  resetQueue: () => void
  /** 设置当前上传阶段 */
  setUploadPhase: (phase: 'idle' | 'uploading' | 'success' | 'error') => void
}

export const useDragDropStore = create<DragDropState>((set) => ({
  // 初始状态
  fileQueue: [],
  uploadPhase: 'idle',

  // 操作方法实现
  addFilesToQueue: (files) => set((state) => ({ fileQueue: [...state.fileQueue, ...files] })),
  resetQueue: () => set({ fileQueue: [], uploadPhase: 'idle' }),
  setUploadPhase: (uploadPhase) => set({ uploadPhase })
}))

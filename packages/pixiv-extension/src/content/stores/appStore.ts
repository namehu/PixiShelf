import { create } from 'zustand';

interface AppState {
  // 应用初始化状态
  isInitialized: boolean;
  
  // 错误状态
  error: string | null;
  
  // 加载状态
  isLoading: boolean;
  
  // 操作方法
  setInitialized: (initialized: boolean) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  
  // 初始化应用
  initializeApp: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  isInitialized: false,
  error: null,
  isLoading: false,
  
  setInitialized: (initialized) => {
    set({ isInitialized: initialized });
  },
  
  setError: (error) => {
    set({ error });
  },
  
  setLoading: (loading) => {
    set({ isLoading: loading });
  },
  
  initializeApp: async () => {
    try {
      set({ isLoading: true, error: null });
      
      // 检查是否在Pixiv页面
      if (!window.location.hostname.includes('pixiv.net')) {
        throw new Error('此扩展只能在Pixiv网站上使用');
      }
      
      // 初始化完成
      set({ isInitialized: true, isLoading: false });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '初始化失败';
      set({ error: errorMessage, isLoading: false, isInitialized: false });
    }
  }
}));
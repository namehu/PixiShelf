import { create } from 'zustand';

interface Position {
  x: number;
  y: number;
}

interface UIState {
  // 面板显示状态
  isVisible: boolean;
  isCollapsed: boolean;
  position: Position;
  
  // 当前活动标签
  activeTab: 'tags' | 'users' | 'artworks';
  
  // 操作方法
  setPosition: (position: Position) => void;
  toggleVisibility: () => void;
  toggleCollapse: () => void;
  setActiveTab: (tab: 'tags' | 'users' | 'artworks') => void;
  
  // 初始化位置
  initializePosition: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isVisible: false,
  isCollapsed: false,
  position: { x: 20, y: 20 },
  activeTab: 'tags',
  
  setPosition: (position) => {
    set({ position });
    // 保存位置到Chrome存储
    chrome.storage.local.set({ 'pixiv-panel-position': position });
  },
  
  toggleVisibility: () => {
    set((state) => ({ isVisible: !state.isVisible }));
  },
  
  toggleCollapse: () => {
    set((state) => ({ isCollapsed: !state.isCollapsed }));
  },
  
  setActiveTab: (tab) => {
    set({ activeTab: tab });
  },
  
  initializePosition: async () => {
    try {
      const result = await chrome.storage.local.get('pixiv-panel-position');
      if (result['pixiv-panel-position']) {
        set({ position: result['pixiv-panel-position'] });
      }
    } catch (error) {
      console.warn('Failed to load panel position:', error);
    }
  }
}));
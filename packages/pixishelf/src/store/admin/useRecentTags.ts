import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// 定义 Option 接口，与 MultipleSelector 兼容
export interface TagOption {
  value: string
  label: string
}

interface RecentTagsState {
  tags: TagOption[]
  addTag: (tag: TagOption) => void
  removeTag: (value: string) => void
}

export const useRecentTags = create<RecentTagsState>()(
  persist(
    (set) => ({
      tags: [],
      addTag: (newTag) =>
        set((state) => {
          // 过滤掉已存在的同名/同值标签
          const filtered = state.tags.filter((t) => t.value !== newTag.value)
          // 添加到头部，并截取前 50 个
          return { tags: [newTag, ...filtered].slice(0, 50) }
        }),
      removeTag: (value) =>
        set((state) => ({
          tags: state.tags.filter((t) => t.value !== value)
        }))
    }),
    {
      name: 'pixishelf-recent-tags',
      storage: createJSONStorage(() => localStorage)
    }
  )
)

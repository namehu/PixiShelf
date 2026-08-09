import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// 定义 Option 接口，与 MultipleSelector 兼容
export interface TagOption {
  value: string
  label: string
}

// 扩展接口以包含 LRU 所需的时间戳
export interface RecentTag extends TagOption {
  lastUsedAt: number
}

interface RecentTagsState {
  tags: RecentTag[]
  addTag: (tag: TagOption) => void
  removeTag: (value: string) => void
}

export const useRecentTags = create<RecentTagsState>()(
  persist(
    (set) => ({
      tags: [],
      addTag: (tag) =>
        set((state) => {
          const now = Date.now()
          const existingIndex = state.tags.findIndex((t) => t.value === tag.value)

          // 1. 如果已存在：只更新 lastUsedAt，保持位置不变
          if (existingIndex !== -1) {
            const newTags = [...state.tags]
            newTags[existingIndex] = { ...newTags[existingIndex]!, lastUsedAt: now }
            return { tags: newTags }
          }

          // 2. 如果是新标签
          let newTags = [...state.tags, { ...tag, lastUsedAt: now }]

          // 3. 检查容量，执行 LRU 淘汰 (移除 lastUsedAt 最小的)
          if (newTags.length > 50) {
            // 找到最早使用的元素索引
            let minIndex = 0
            let minTime = newTags[0]!.lastUsedAt

            for (let i = 1; i < newTags.length; i++) {
              if (newTags[i]!.lastUsedAt < minTime) {
                minTime = newTags[i]!.lastUsedAt
                minIndex = i
              }
            }

            // 移除该元素
            newTags.splice(minIndex, 1)
          }

          return { tags: newTags }
        }),
      removeTag: (value) =>
        set((state) => ({
          tags: state.tags.filter((t) => t.value !== value)
        }))
    }),
    {
      name: 'pixishelf-recent-tags',
      storage: createJSONStorage(() => localStorage),
      version: 2, // 升级版本号，因为数据结构变了
      migrate: (persistedState: any, version) => {
        if (version === 0) {
          // 迁移旧数据: TagOption[] -> RecentTag[]
          // 假设 persistedState.tags 是 TagOption[]
          const tags = (persistedState.tags || []) as TagOption[]
          return {
            ...persistedState,
            tags: tags.map((t, i) => ({ ...t, lastUsedAt: Date.now() - (tags.length - i) * 1000 }))
          }
        }
        return persistedState
      }
    }
  )
)

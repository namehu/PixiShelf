'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { PreferenceItem } from '@/app/settings/_components/preference-item'
import { useTRPC, useTRPCClient } from '@/lib/trpc'

export function SystemSettingsPanel() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAppliedPersistedTagIdsKeyRef = useRef<string | null>(null)
  const [replaceDefaultTagIds, setReplaceDefaultTagIds] = useState<number[]>([])

  const systemSettingsQuery = useQuery(trpc.setting.getSystemSettings.queryOptions())
  const persistedTagIds = systemSettingsQuery.data?.settings.replace_default_tag_ids
  const persistedTagIdsKey = useMemo(() => (persistedTagIds ?? []).join(','), [persistedTagIds])
  const tagIdsKey = useMemo(() => replaceDefaultTagIds.join(','), [replaceDefaultTagIds])
  const selectedTagsQuery = useQuery(
    trpc.tag.getByIds.queryOptions(
      { ids: replaceDefaultTagIds },
      {
        enabled: replaceDefaultTagIds.length > 0
      }
    )
  )

  const updateMutation = useMutation(
    trpc.setting.updateSystemSettings.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(trpc.setting.getSystemSettings.queryKey(), data)
        toast.success('系统设置已自动保存')
      },
      onError: (error) => {
        toast.error(`系统设置保存失败: ${error.message}`)
      }
    })
  )

  useEffect(() => {
    if (lastAppliedPersistedTagIdsKeyRef.current === persistedTagIdsKey) {
      return
    }

    lastAppliedPersistedTagIdsKeyRef.current = persistedTagIdsKey
    const nextIds = persistedTagIds ?? []
    setReplaceDefaultTagIds(nextIds)
  }, [persistedTagIds, persistedTagIdsKey])

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }
    }
  }, [])

  const scheduleSave = (nextTagIds: number[]) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
    }

    saveTimer.current = setTimeout(() => {
      updateMutation.mutate({
        replace_default_tag_ids: nextTagIds
      })
    }, 500)
  }

  const selectedTagOptions = useMemo<Option[]>(() => {
    const tagMap = new Map(
      (selectedTagsQuery.data?.items ?? []).map((tag) => [
        tag.id,
        {
          value: tag.id.toString(),
          label: tag.name_zh || tag.name_en || tag.name
        }
      ])
    )

    return replaceDefaultTagIds.map((id) => tagMap.get(id) || { value: id.toString(), label: `#${id}` })
  }, [replaceDefaultTagIds, selectedTagsQuery.data?.items, tagIdsKey])

  const handleSearchTag = async (query: string): Promise<Option[]> => {
    const res = await trpcClient.tag.list.query({
      cursor: 1,
      pageSize: 20,
      mode: 'popular',
      query
    })

    return res.items.map((tag) => ({
      value: tag.id.toString(),
      label: tag.name_zh || tag.name_en || tag.name
    }))
  }

  const handleDefaultTagsChange = (options: Option[]) => {
    const nextIds = options
      .map((item) => Number(item.value))
      .filter((id) => Number.isInteger(id) && id > 0)

    setReplaceDefaultTagIds(nextIds)
    scheduleSave(nextIds)
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold text-neutral-900">系统设置</h1>
          <p className="text-neutral-600">配置对所有用户和后台流程生效的系统级选项</p>
        </div>

        <PreferenceItem
          title="作品全量替换默认标签"
          description="选择默认追加的标签。作品执行全量替换成功后，会保留原标签并自动补上这些标签"
        >
          <div className="w-full sm:max-w-xl">
            <MultipleSelector
              value={selectedTagOptions}
              onSearch={handleSearchTag}
              onChange={handleDefaultTagsChange}
              triggerSearchOnFocus
              placeholder="搜索并选择默认标签..."
              disabled={systemSettingsQuery.isLoading || updateMutation.isPending}
              emptyIndicator={<p className="py-4 text-center text-sm text-slate-500">暂无可选标签</p>}
            />
            <div className="mt-2 text-xs text-neutral-500">
              {updateMutation.isPending ? '保存中...' : `当前已选择 ${replaceDefaultTagIds.length} 个默认标签`}
            </div>
          </div>
        </PreferenceItem>
      </div>
    </div>
  )
}

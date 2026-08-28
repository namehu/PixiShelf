'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { PreferenceItem } from '@/app/settings/_components/preference-item'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { ArchiveDefaultTagBackfillControl } from './archive-default-tag-backfill-control'

export function SystemSettingsPanel() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAppliedPersistedSettingsKeyRef = useRef<string | null>(null)
  const [replaceDefaultTagIds, setReplaceDefaultTagIds] = useState<number[]>([])
  const [localImportDefaultTagIds, setLocalImportDefaultTagIds] = useState<number[]>([])
  const [archiveDefaultTagIds, setArchiveDefaultTagIds] = useState<number[]>([])
  const [saveScheduled, setSaveScheduled] = useState(false)

  const systemSettingsQuery = useQuery(trpc.setting.getSystemSettings.queryOptions())
  const persistedReplaceTagIds = systemSettingsQuery.data?.settings.replace_default_tag_ids
  const persistedLocalImportTagIds = systemSettingsQuery.data?.settings.local_import_default_tag_ids
  const persistedArchiveTagIds = systemSettingsQuery.data?.settings.archive_default_tag_ids
  const persistedSettingsKey = useMemo(
    () =>
      `${(persistedReplaceTagIds ?? []).join(',')}|${(persistedLocalImportTagIds ?? []).join(',')}|${(persistedArchiveTagIds ?? []).join(',')}`,
    [persistedArchiveTagIds, persistedLocalImportTagIds, persistedReplaceTagIds]
  )
  const archiveSettingsDirty = useMemo(
    () => canonicalIds(archiveDefaultTagIds) !== canonicalIds(persistedArchiveTagIds ?? []),
    [archiveDefaultTagIds, persistedArchiveTagIds]
  )
  const selectedTagIds = useMemo(
    () => Array.from(new Set([...replaceDefaultTagIds, ...localImportDefaultTagIds, ...archiveDefaultTagIds])),
    [archiveDefaultTagIds, localImportDefaultTagIds, replaceDefaultTagIds]
  )
  const selectedTagsQuery = useQuery(
    trpc.tag.getByIds.queryOptions(
      { ids: selectedTagIds },
      {
        enabled: selectedTagIds.length > 0
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
      },
      onSettled: () => {
        setSaveScheduled(false)
      }
    })
  )

  useEffect(() => {
    if (lastAppliedPersistedSettingsKeyRef.current === persistedSettingsKey) {
      return
    }

    lastAppliedPersistedSettingsKeyRef.current = persistedSettingsKey
    setReplaceDefaultTagIds(persistedReplaceTagIds ?? [])
    setLocalImportDefaultTagIds(persistedLocalImportTagIds ?? [])
    setArchiveDefaultTagIds(persistedArchiveTagIds ?? [])
  }, [persistedArchiveTagIds, persistedLocalImportTagIds, persistedReplaceTagIds, persistedSettingsKey])

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }
    }
  }, [])

  const scheduleSave = (nextReplaceTagIds: number[], nextLocalImportTagIds: number[], nextArchiveTagIds: number[]) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
    }
    setSaveScheduled(true)

    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      updateMutation.mutate({
        replace_default_tag_ids: nextReplaceTagIds,
        local_import_default_tag_ids: nextLocalImportTagIds,
        archive_default_tag_ids: nextArchiveTagIds
      })
    }, 500)
  }

  const selectedTagOptionsById = useMemo(() => {
    const tagMap = new Map(
      (selectedTagsQuery.data?.items ?? []).map((tag) => [
        tag.id,
        {
          value: tag.id.toString(),
          label: tag.name_zh || tag.name_en || tag.name
        }
      ])
    )

    return (ids: number[]): Option[] => ids.map((id) => tagMap.get(id) || { value: id.toString(), label: `#${id}` })
  }, [selectedTagsQuery.data?.items])

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
    const nextIds = options.map((item) => Number(item.value)).filter((id) => Number.isInteger(id) && id > 0)

    setReplaceDefaultTagIds(nextIds)
    scheduleSave(nextIds, localImportDefaultTagIds, archiveDefaultTagIds)
  }

  const handleLocalImportDefaultTagsChange = (options: Option[]) => {
    const nextIds = options.map((item) => Number(item.value)).filter((id) => Number.isInteger(id) && id > 0)

    setLocalImportDefaultTagIds(nextIds)
    scheduleSave(replaceDefaultTagIds, nextIds, archiveDefaultTagIds)
  }

  const handleArchiveDefaultTagsChange = (options: Option[]) => {
    const nextIds = options.map((item) => Number(item.value)).filter((id) => Number.isInteger(id) && id > 0)

    setArchiveDefaultTagIds(nextIds)
    scheduleSave(replaceDefaultTagIds, localImportDefaultTagIds, nextIds)
  }

  return (
    <div className="py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">系统设置</h2>
          <p className="mt-1 text-sm text-muted-foreground">配置对所有用户和后台流程生效的系统级选项。</p>
        </div>

        <PreferenceItem
          title="作品全量替换默认标签"
          description="选择默认追加的标签。作品执行全量替换成功后，会保留原标签并自动补上这些标签"
        >
          <div className="w-full sm:max-w-xl">
            <MultipleSelector
              value={selectedTagOptionsById(replaceDefaultTagIds)}
              onSearch={handleSearchTag}
              onChange={handleDefaultTagsChange}
              triggerSearchOnFocus
              placeholder="搜索并选择全量替换默认标签..."
              disabled={systemSettingsQuery.isLoading || updateMutation.isPending}
              emptyIndicator={<p className="py-4 text-center text-sm text-muted-foreground">暂无可选标签</p>}
            />
            <div className="mt-2 text-xs text-muted-foreground">
              {updateMutation.isPending ? '保存中...' : `当前已选择 ${replaceDefaultTagIds.length} 个默认标签`}
            </div>
          </div>
        </PreferenceItem>

        <PreferenceItem
          title="本地目录导入默认标签"
          description="选择默认追加的标签。新作品从本地目录导入成功后，会自动补上这些标签"
        >
          <div className="w-full sm:max-w-xl">
            <MultipleSelector
              value={selectedTagOptionsById(localImportDefaultTagIds)}
              onSearch={handleSearchTag}
              onChange={handleLocalImportDefaultTagsChange}
              triggerSearchOnFocus
              placeholder="搜索并选择本地导入默认标签..."
              disabled={systemSettingsQuery.isLoading || updateMutation.isPending}
              emptyIndicator={<p className="py-4 text-center text-sm text-muted-foreground">暂无可选标签</p>}
            />
            <div className="mt-2 text-xs text-muted-foreground">
              {updateMutation.isPending ? '保存中...' : `当前已选择 ${localImportDefaultTagIds.length} 个默认标签`}
            </div>
          </div>
        </PreferenceItem>

        <PreferenceItem
          title="归档默认标签"
          description="选择默认追加的标签。作品从归档收件箱导入并发布成功后，会自动补上这些标签"
        >
          <div className="w-full sm:max-w-xl">
            <MultipleSelector
              value={selectedTagOptionsById(archiveDefaultTagIds)}
              onSearch={handleSearchTag}
              onChange={handleArchiveDefaultTagsChange}
              triggerSearchOnFocus
              placeholder="搜索并选择归档默认标签..."
              disabled={systemSettingsQuery.isLoading || updateMutation.isPending}
              emptyIndicator={<p className="py-4 text-center text-sm text-muted-foreground">暂无可选标签</p>}
            />
            <div className="mt-2 text-xs text-muted-foreground">
              {updateMutation.isPending ? '保存中...' : `当前已选择 ${archiveDefaultTagIds.length} 个默认标签`}
            </div>
            <ArchiveDefaultTagBackfillControl
              hasDefaultTags={archiveDefaultTagIds.length > 0}
              settingSaving={saveScheduled || updateMutation.isPending || archiveSettingsDirty}
            />
          </div>
        </PreferenceItem>
      </div>
    </div>
  )
}

function canonicalIds(ids: number[]) {
  return [...ids].sort((left, right) => left - right).join(',')
}

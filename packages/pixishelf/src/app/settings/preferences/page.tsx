'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { updateUserSettingAction } from '@/actions/user-setting-action'
import { PreferenceItem } from '../_components/preference-item'
import { useUserSettings } from '@/components/user-setting'
import { useTRPC } from '@/lib/trpc'

type DisplayMode = 'card' | 'minimal'

const DISPLAY_MODE_KEY = 'artwork_display_mode'
const PREFERRED_TAGS_KEY = 'preferred_tags'

function parsePreferredTags(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((item) => typeof item === 'string')
  }
  return []
}

export default function SettingsPreferencesPage() {
  const trpc = useTRPC()
  const { settings, updateSettingLocally } = useUserSettings()

  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    settings[DISPLAY_MODE_KEY] === 'minimal' ? 'minimal' : 'card'
  )
  const [preferredTags, setPreferredTags] = useState<string[]>(parsePreferredTags(settings[PREFERRED_TAGS_KEY]))

  useEffect(() => {
    setDisplayMode(settings[DISPLAY_MODE_KEY] === 'minimal' ? 'minimal' : 'card')
    setPreferredTags(parsePreferredTags(settings[PREFERRED_TAGS_KEY]))
  }, [settings])

  const { data: tagsData } = useQuery(
    trpc.tag.list.queryOptions({
      cursor: 1,
      pageSize: 100,
      mode: 'popular'
    })
  )

  const tagOptions = useMemo<Option[]>(
    () =>
      (tagsData?.items ?? []).map((tag) => ({
        value: tag.name,
        label: tag.name_zh || tag.name_en || tag.name
      })),
    [tagsData?.items]
  )

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }
    }
  }, [])

  const { execute, isExecuting } = useAction(updateUserSettingAction, {
    onError: ({ error }) => {
      const message = error.validationErrors?.formErrors?.[0] || error.serverError || '保存偏好失败'
      toast.error(message)
    },
    onSuccess: () => {
      toast.success('偏好已自动保存')
    }
  })

  const scheduleSave = (nextDisplayMode: DisplayMode, nextPreferredTags: string[]) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
    }
    saveTimer.current = setTimeout(() => {
      execute({
        settings: [
          { key: DISPLAY_MODE_KEY, value: nextDisplayMode, type: 'string' },
          { key: PREFERRED_TAGS_KEY, value: nextPreferredTags, type: 'json' }
        ]
      })
    }, 500)
  }

  const onDisplayModeChange = (value: DisplayMode) => {
    setDisplayMode(value)
    updateSettingLocally(DISPLAY_MODE_KEY, value)
    scheduleSave(value, preferredTags)
  }

  const selectedTagOptions = useMemo<Option[]>(
    () =>
      preferredTags.map((tagName) => ({
        value: tagName,
        label: tagOptions.find((item) => item.value === tagName)?.label || tagName
      })),
    [preferredTags, tagOptions]
  )

  const onPreferredTagsChange = (options: Option[]) => {
    const values = options.map((item) => item.value)
    setPreferredTags(values)
    updateSettingLocally(PREFERRED_TAGS_KEY, values)
    scheduleSave(displayMode, values)
  }

  return (
    <div className="space-y-4">
      <PreferenceItem
        title="作品列表显示模式"
        description="卡片模式显示标题和作者；极简模式使用 2px 间距并隐藏文字信息"
      >
        <Select
          value={displayMode}
          onValueChange={(value) => onDisplayModeChange(value as DisplayMode)}
          disabled={isExecuting}
        >
          <SelectTrigger className="w-full sm:w-[420px]">
            <SelectValue placeholder="选择展示模式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="card">包含间距的卡片模式</SelectItem>
            <SelectItem value="minimal">极简模式（2px 间距）</SelectItem>
          </SelectContent>
        </Select>
      </PreferenceItem>

      <PreferenceItem title="优选标签" description="选择你常关注的标签，便于在作品列表中快速识别偏好内容">
        <div className="w-full sm:max-w-xl">
          <MultipleSelector
            value={selectedTagOptions}
            options={tagOptions}
            placeholder="选择标签..."
            onChange={onPreferredTagsChange}
            emptyIndicator={<p className="text-center text-sm text-slate-500 py-4">暂无可选标签</p>}
          />
        </div>
      </PreferenceItem>
    </div>
  )
}

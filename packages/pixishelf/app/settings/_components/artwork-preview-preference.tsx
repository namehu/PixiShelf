'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { useArtworkDetailPreferences, useArtworkDetailPreferencesReady } from '@/store/use-artwork-detail-preferences'
import { PreferenceItem } from './preference-item'

export function ArtworkPreviewPreference() {
  const ready = useArtworkDetailPreferencesReady()
  const count = useArtworkDetailPreferences((state) => state.previewCount)
  const setCount = useArtworkDetailPreferences((state) => state.setPreviewCount)
  const [draft, setDraft] = useState(String(count))
  useEffect(() => setDraft(String(count)), [count])
  const commit = () => {
    if (draft.trim() && Number.isFinite(Number(draft))) setCount(Number(draft))
    setDraft(String(useArtworkDetailPreferences.getState().previewCount))
  }
  return (
    <PreferenceItem
      title="作品初始展示数量"
      description="每次进入详情先展示多少项媒体（1–100）。剩余不超过设定数量的 25% 时直接全部显示。仅保存在当前浏览器。"
    >
      <div className="flex w-full items-center gap-4 sm:max-w-[420px]">
        <Slider
          aria-label="作品初始展示数量"
          min={1}
          max={100}
          step={1}
          value={[count]}
          disabled={!ready}
          onValueChange={([value]) => {
            if (value !== undefined) setCount(value)
          }}
        />
        <Input
          aria-label="作品初始展示数量数值"
          type="number"
          min={1}
          max={100}
          step={1}
          className="w-20 shrink-0"
          value={draft}
          disabled={!ready}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
              event.currentTarget.blur()
            }
          }}
        />
      </div>
    </PreferenceItem>
  )
}

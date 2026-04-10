'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Checkbox } from '@/components/ui/checkbox'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import InfiniteArtworkGrid from './InfiniteArtworkGrid'
import { EnhancedArtworksResponse } from '@/types'
import { usePreferredTags } from '@/components/user-setting'
import { ROUTES } from '@/lib/constants'
import { useMediaQuery } from '@/hooks/use-media-query'

interface RecommendedArtworkSectionProps {
  initialData: EnhancedArtworksResponse & { nextCursor?: number }
}

export default function RecommendedArtworkSection({ initialData }: RecommendedArtworkSectionProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const preferredTags = usePreferredTags()
  const [open, setOpen] = useState(false)
  const [appliedTags, setAppliedTags] = useState<string[]>([])
  const [draftTags, setDraftTags] = useState<string[]>([])

  const preferredTagOptions = useMemo<Option[]>(
    () =>
      preferredTags.map((tagName) => ({
        value: tagName,
        label: tagName
      })),
    [preferredTags]
  )

  const draftTagOptions = useMemo<Option[]>(
    () =>
      draftTags.map((tagName) => ({
        value: tagName,
        label: preferredTagOptions.find((item) => item.value === tagName)?.label || tagName
      })),
    [draftTags, preferredTagOptions]
  )

  useEffect(() => {
    if (open) {
      setDraftTags(appliedTags)
    }
  }, [open, appliedTags])

  const handleApplyFilter = () => {
    setAppliedTags(draftTags)
    setOpen(false)
  }

  const handleToggleDraftTag = (tagName: string) => {
    setDraftTags((prev) => (prev.includes(tagName) ? prev.filter((item) => item !== tagName) : [...prev, tagName]))
  }

  const emptyState = (
    <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-600">
      你还没有设置偏好标签，请先前往
      <Link href={ROUTES.SETTINGS_PREFERENCES} className="text-blue-600 hover:text-blue-700 ml-1">
        偏好设置
      </Link>
      添加。
    </div>
  )

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">推荐作品</h3>
          <p className="text-gray-600">为您精心挑选的优质作品</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            {appliedTags.length > 0 ? `偏好筛选 (${appliedTags.length})` : '偏好筛选'}
          </Button>
        </div>
      </div>

      <InfiniteArtworkGrid initialData={initialData} selectedTags={appliedTags} />

      {isDesktop ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>按偏好标签筛选推荐作品</DialogTitle>
            </DialogHeader>

            {preferredTagOptions.length > 0 ? (
              <MultipleSelector
                value={draftTagOptions}
                options={preferredTagOptions}
                placeholder="选择偏好标签..."
                onChange={(options) => setDraftTags(options.map((item) => item.value))}
                emptyIndicator={<p className="text-center text-sm text-slate-500 py-4">暂无可选偏好标签</p>}
              />
            ) : (
              emptyState
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button onClick={handleApplyFilter} disabled={preferredTagOptions.length === 0}>
                应用筛选
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>按偏好标签筛选推荐作品</DrawerTitle>
            </DrawerHeader>

            <div className="px-4 pb-2">
              {preferredTagOptions.length > 0 ? (
                <div className="max-h-[50vh] overflow-y-auto space-y-2">
                  {preferredTagOptions.map((item) => {
                    const checked = draftTags.includes(item.value)
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm flex items-center gap-3"
                        onClick={() => handleToggleDraftTag(item.value)}
                      >
                        <Checkbox checked={checked} />
                        <span className="truncate">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                emptyState
              )}
            </div>

            <DrawerFooter>
              <Button onClick={handleApplyFilter} disabled={preferredTagOptions.length === 0}>
                应用筛选
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  )
}

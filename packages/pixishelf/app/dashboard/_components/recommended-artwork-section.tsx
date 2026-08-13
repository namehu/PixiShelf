'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import InfiniteArtworkGrid from './infinite-artwork-grid'
import { ArtworkCardListResponse } from '@/types'
import { usePreferredTags } from '@/components/user-setting'
import { ROUTES } from '@/lib/constants'
import { useMediaQuery } from '@/hooks/use-media-query'
import { SectionHeader } from '@/components/layout/section-header'

interface RecommendedArtworkSectionProps {
  initialData: ArtworkCardListResponse & { nextCursor?: number }
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
    <div className="rounded-md border border-dashed border-border bg-surface-muted px-4 py-5 text-sm text-muted-foreground">
      你还没有设置偏好标签，请先前往
      <Link href={ROUTES.SETTINGS_PREFERENCES} className="ml-1 text-primary underline-offset-4 hover:underline">
        偏好设置
      </Link>
      添加。
    </div>
  )

  return (
    <section aria-labelledby="dashboard-recommended-heading" className="mb-12">
      <SectionHeader
        className="mb-5"
        title={<span id="dashboard-recommended-heading">推荐作品</span>}
        description="依据偏好标签整理的个人推荐集合。"
        actions={
          <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
            <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
            {appliedTags.length > 0 ? `偏好筛选 (${appliedTags.length})` : '偏好筛选'}
          </Button>
        }
      />

      <InfiniteArtworkGrid initialData={initialData} selectedTags={appliedTags} />

      {isDesktop ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>按偏好标签筛选推荐作品</DialogTitle>
              <DialogDescription>只显示同时符合所选偏好标签的推荐作品。</DialogDescription>
            </DialogHeader>

            {preferredTagOptions.length > 0 ? (
              <MultipleSelector
                value={draftTagOptions}
                options={preferredTagOptions}
                placeholder="选择偏好标签..."
                onChange={(options) => setDraftTags(options.map((item) => item.value))}
                emptyIndicator={<p className="py-4 text-center text-sm text-muted-foreground">暂无可选偏好标签</p>}
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
              <DrawerDescription>只显示同时符合所选偏好标签的推荐作品。</DrawerDescription>
            </DrawerHeader>

            <div className="px-4 pb-2">
              {preferredTagOptions.length > 0 ? (
                <FieldSet className="gap-3">
                  <FieldLegend className="sr-only">选择偏好标签</FieldLegend>
                  <FieldGroup
                    data-slot="checkbox-group"
                    className="max-h-[50dvh] gap-2 overflow-y-auto overscroll-contain"
                  >
                    {preferredTagOptions.map((item) => {
                      const checked = draftTags.includes(item.value)
                      const checkboxId = `recommended-tag-${item.value}`
                      return (
                        <Field
                          key={item.value}
                          orientation="horizontal"
                          className="min-h-11 rounded-md border border-border px-3 py-2"
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={() => handleToggleDraftTag(item.value)}
                          />
                          <FieldLabel htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer truncate">
                            {item.label}
                          </FieldLabel>
                        </Field>
                      )
                    })}
                  </FieldGroup>
                </FieldSet>
              ) : (
                emptyState
              )}
            </div>

            <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
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
    </section>
  )
}

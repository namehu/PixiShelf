'use client'

import type { ArtworkDedupArtworkPreviewDto, ArtworkDedupOperationDto } from '@pixishelf/job-contracts'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Checkbox } from '@/components/ui/checkbox'
import { useTRPC } from '@/lib/trpc'
import { useDuplicateIntent } from './use-duplicate-intent'

type Source = ArtworkDedupArtworkPreviewDto['sources'][number]
export function DuplicateReimport({
  operation,
  userId,
  items,
  disabled,
  onUpdate,
  onRefresh
}: {
  operation: ArtworkDedupOperationDto
  userId: string
  items: ArtworkDedupArtworkPreviewDto[]
  disabled: boolean
  onUpdate: (operation: ArtworkDedupOperationDto) => void
  onRefresh: () => void
}) {
  const trpc = useTRPC()
  const mutation = useMutation(trpc.artworkDedup.allowReimport.mutationOptions())
  const intent = useDuplicateIntent()
  const [selected, setSelected] = useState<Record<string, Source>>({})
  const [confirm, setConfirm] = useState(false)
  const sources = Array.from(
    new Map(
      items
        .filter((item) => item.canAllowReimport)
        .flatMap((item) => item.sources.filter((source) => source.status === 'TOMBSTONE'))
        .map((source) => [source.sourceId, source])
    ).values()
  )
  const count = Object.keys(selected).length
  const busy = intent.pending.size > 0
  if (
    operation.preparePurpose !== 'DIRECT_DELETE' ||
    operation.status !== 'DELETED' ||
    !operation.allowedActions.includes('ALLOW_REIMPORT') ||
    (sources.length === 0 && count === 0)
  ) {
    return null
  }
  return (
    <section className="flex flex-col gap-3 border-t pt-5" aria-label="允许重新导入">
      <h3 className="text-sm font-medium">允许重新导入</h3>
      <p className="text-sm text-muted-foreground">仅解除选定来源的导入保护，不会恢复已删除文件。</p>
      {sources.map((source) => (
        <label key={source.sourceId} className="flex min-h-11 items-center gap-3 text-sm">
          <Checkbox
            checked={Boolean(selected[source.sourceId])}
            disabled={disabled || busy || (!selected[source.sourceId] && count >= 100)}
            onCheckedChange={(checked) =>
              setSelected((current) => {
                const next = { ...current }
                if (checked === true) next[source.sourceId] = source
                else delete next[source.sourceId]
                return next
              })
            }
          />
          <PrivacySensitiveText className="break-all">{source.displayName}</PrivacySensitiveText>
        </label>
      ))}
      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="min-h-11" disabled={disabled || busy} onClick={() => setConfirm(true)}>
            允许所选 {count} 个来源重新导入
          </Button>
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setSelected({})}>
            清除选择
          </Button>
        </div>
      ) : null}
      {intent.failed.size > 0 ? (
        <p role="alert" className="text-sm text-destructive">
          尚未确认，请刷新状态后重试。
        </p>
      ) : null}
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>允许这 {count} 个来源重新导入？</AlertDialogTitle>
            <AlertDialogDescription>
              只允许未来的新输入创建作品；旧任务不会重新生效，已删除的文件和整理记录不会恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Button
            className="min-h-11"
            disabled={disabled || busy || count === 0}
            onClick={() => {
              const input = {
                operationId: operation.operationId,
                expectedVersion: operation.version,
                expectedUserId: userId,
                sources: Object.values(selected).map((source) => ({
                  sourceId: source.sourceId,
                  expectedGeneration: source.generation
                }))
              }
              void intent.execute(
                'reimport',
                JSON.stringify(input),
                (key) => mutation.mutateAsync({ ...input, idempotencyKey: key }),
                (next) => {
                  setSelected({})
                  setConfirm(false)
                  onUpdate(next)
                },
                onRefresh
              )
            }}
          >
            确认允许重新导入
          </Button>
          <AlertDialogCancel className="min-h-11" disabled={busy}>
            返回
          </AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
